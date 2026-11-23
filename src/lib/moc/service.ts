// Fork（almanac ALMNC-69.7）：MOC 是唯一依據的流程——重建筆記 domains、把筆記收進 MOC、從 MOC 拿掉。
// I/O 經 MocIo 注入（App 用 runtime.ts 的 Tauri 版，測試用記憶體版），這裡只串流程；判斷都在純函式（parse／edit／membership）。
//
// - rebuildFromMocs：讀全部 MOC → 正式收錄 → 每則筆記的 domains（rebuildDomains：保留 Scott 排的順序、新的接後面、主要被移除時遞補）
//   → 只在有變化時用協調寫入改 frontmatter domains；超過 3 個領域的不寫、回報 overLimit（工作台出卡請 Scott 選）。
// - assignToMocs：檯面「歸入領域」、提案、領域提案都走這裡——把收錄行寫進該 MOC 的「尚未分章」，再重建 domains。
//   找不到 MOC 檔的領域：先建 MOC 骨架（M 編號、五區塊，格式同 69.6 遷移），再收進去（降級做法：不寫回筆記 frontmatter）。
// - removeFromMoc：拿掉某則筆記在某個 MOC 的收錄（超過上限時 Scott 在卡上選的那個），再重建。
import { DEFAULT_DOMAIN_FOLDER, mocFileName, renderMocContent } from '@/lib/migration/domain-moc-migration'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import { parseV3Note, writeV3NoteFields } from '@/lib/v3-model/note'
import { addMocEntry, removeMocEntry, replaceMocEntryTarget } from './edit'
import { membershipsFromMocs, planDomainRebuild, type DomainRebuildPlan, type NoteDomainChange } from './membership'
import { formalEntries, parseMoc, type ParsedMoc } from './parse'

export interface MocFile {
  path: string
  raw: string
}

export interface MocWrite {
  path: string
  before: string
  after: string
  /** 寫入前內容又被改過時，把同一個動作套到最新內容；套不上回傳 null（跳過，下次再處理）。 */
  rebase?: (latest: string) => string | null
}

export interface MocIo {
  /** 筆記庫裡的 MOC 檔（frontmatter kind: domain）＋extra 指定的路徑（剛建、索引還沒看到的）。 */
  listMocFiles: (extra?: readonly string[]) => Promise<MocFile[]>
  /** 有 frontmatter 的筆記與它現有的 domains（筆記庫索引即可；寫入前會再讀原文確認）。 */
  listNotes: () => Promise<Array<{ path: string, domains: readonly string[] }>>
  /** 筆記庫全部檔案路徑（解析收錄連結用）。 */
  paths: () => readonly string[]
  readFile: (path: string) => Promise<string | null>
  /** 協調寫入；回傳真的寫成的。寫不成（衝突、檔案不見）的略過，不丟例外。 */
  commit: (writes: readonly MocWrite[]) => Promise<Array<{ path: string, before: string, after: string }>>
  /** 建新檔（已存在就丟例外，不覆寫）。 */
  createFile: (path: string, content: string) => Promise<void>
  removeFile?: (path: string) => Promise<void>
  /** 舊 dom_ id／名稱 → 領域名稱（domains 表）。 */
  domainNames: () => Promise<ReadonlyMap<string, string>>
  newId: (kind: 'M' | 'C') => Promise<string>
  /** 登記 MOC 到系統索引（M ↔ 路徑、名稱）。 */
  recordMoc?: (input: { id: string, path: string, name: string }) => Promise<void>
  /** 建 MOC 骨架的資料夾（預設「20 領域」）。 */
  folder?: string
}

export interface RebuildResult {
  mocs: ParsedMoc[]
  plan: DomainRebuildPlan
  /** 寫成的筆記路徑。 */
  written: string[]
  /** 寫成的筆記前後內容（復原用）。 */
  committed: Array<{ path: string, before: string, after: string }>
  /** 要寫但沒寫成（衝突、讀不到）的筆記。 */
  skipped: string[]
  overLimit: NoteDomainChange[]
}

export interface RebuildOptions {
  /** 新加的領域依這個順序接在後面（第一個成為主要）。 */
  orderHint?: ReadonlyMap<string, readonly string[]>
  /** 索引還沒看到的筆記與 MOC 路徑（剛寫的）。 */
  extraNotes?: readonly string[]
  extraMocs?: readonly string[]
}

/** 復原用：把寫入倒過來（依相反順序，內容仍是寫入後的才改回）。 */
function reverse(writes: ReadonlyArray<{ path: string, before: string, after: string }>): MocWrite[] {
  return [...writes].reverse().map(write => ({ path: write.path, before: write.after, after: write.before }))
}

function unique<T>(list: readonly T[]): T[] {
  return Array.from(new Set(list))
}

/** 收錄行的連結目標：檔名（去掉 .md）；筆記庫裡有同名檔時用路徑。 */
export function entryTargetFor(notePath: string, paths: readonly string[]): string {
  const base = (notePath.split('/').pop() ?? notePath).replace(/\.md$/i, '')
  const key = base.toLowerCase()
  const clash = paths.some(path => path !== notePath && /\.md$/i.test(path) && (path.split('/').pop() ?? path).replace(/\.md$/i, '').toLowerCase() === key)
  return clash ? notePath.replace(/\.md$/i, '') : base
}

async function loadMocs(io: MocIo, extra: readonly string[] = []): Promise<Array<{ file: MocFile, moc: ParsedMoc }>> {
  const files = await io.listMocFiles(extra)
  return files.map(file => ({ file, moc: parseMoc(file.raw, file.path) })).filter(item => item.moc.isMoc && item.moc.name)
}

/** 由 MOC 重建筆記的 domains。 */
export async function rebuildFromMocs(io: MocIo, options: RebuildOptions = {}): Promise<RebuildResult> {
  const loaded = await loadMocs(io, options.extraMocs)
  const mocs = loaded.map(item => item.moc)
  const mocPaths = new Set(loaded.map(item => item.file.path))
  const paths = unique([...io.paths(), ...(options.extraNotes ?? []), ...mocPaths])
  const lookup = buildLinkLookup(paths)
  const { byNote } = membershipsFromMocs(mocs, (target, mocPath) => resolveWikilinkTargetWithLookup(target, lookup, mocPath ?? ''))
  for (const path of [...byNote.keys()]) if (mocPaths.has(path) || !/\.md$/i.test(path)) byNote.delete(path)
  const managed = new Set(mocs.map(moc => moc.name.trim()))
  const aliases = await io.domainNames().catch(() => new Map<string, string>())

  const indexed = (await io.listNotes()).filter(note => !mocPaths.has(note.path))
  const known = new Set(indexed.map(note => note.path))
  const notes = [...indexed, ...[...byNote.keys()].filter(path => !known.has(path)).map(path => ({ path, domains: [] as string[] }))]
  const plannedOptions = { managed, aliases, orderHint: options.orderHint }
  const plan = planDomainRebuild(notes, byNote, plannedOptions)

  // 索引可能落後：寫之前讀原文重算一次，只在真的有變化時寫；寫入時內容又被改過就用最新內容再算。
  const recompute = (path: string, raw: string): string | null => {
    const fields = parseV3Note(raw).fields
    const again = planDomainRebuild([{ path, domains: fields.domains }], byNote, plannedOptions)
    const change = again.changes[0]
    return change ? writeV3NoteFields(raw, { domains: change.after }) : raw
  }
  const writes: MocWrite[] = []
  const skipped: string[] = []
  const unread = [...plan.changes.map(change => change.path), ...[...byNote.keys()].filter(path => !known.has(path))]
  for (const path of unique(unread)) {
    const raw = await io.readFile(path).catch(() => null)
    if (raw === null) {
      if (plan.changes.some(change => change.path === path)) skipped.push(path)
      continue
    }
    let after: string | null
    try {
      after = recompute(path, raw)
    } catch {
      // frontmatter 壞了：不動，留給 Scott 修。
      skipped.push(path)
      continue
    }
    if (after === null || after === raw) continue
    writes.push({ path, before: raw, after, rebase: latest => { try { return recompute(path, latest) } catch { return null } } })
  }
  const committed = writes.length ? await io.commit(writes) : []
  const written = committed.map(write => write.path)
  for (const write of writes) if (!written.includes(write.path)) skipped.push(write.path)
  return { mocs, plan, written, committed, skipped: unique(skipped), overLimit: plan.overLimit }
}

// ── 收進 MOC ────────────────────────────────────────────────

export interface AssignRequest {
  notePath: string
  /** 領域名稱或舊 dom_ id。 */
  domain: string
}

export interface AssignResult {
  /** 改到的 MOC 檔（含新建的）。 */
  mocPaths: string[]
  /** 新建的 MOC 骨架。 */
  created: string[]
  /** 對不到領域名稱、或寫不進去的要求。 */
  failed: AssignRequest[]
  rebuild: RebuildResult
  /** 復原：改回 MOC 原文、刪掉新建的骨架，再重建。 */
  undo?: () => Promise<void>
}

function nameOf(ref: string, names: ReadonlyMap<string, string>, mocs: readonly ParsedMoc[]): string | null {
  const key = ref.trim()
  if (!key) return null
  if (mocs.some(moc => moc.name === key)) return key
  return names.get(key) ?? (key.startsWith('dom_') ? null : key)
}

/** 新 MOC 骨架的路徑：<資料夾>/<名稱>.md，被佔用就加序號。 */
function skeletonPath(folder: string, name: string, taken: ReadonlySet<string>): string {
  const base = `${folder ? `${folder}/` : ''}${mocFileName(name)}`
  for (let n = 1; n < 100; n++) {
    const path = n === 1 ? `${base}.md` : `${base} ${n}.md`
    if (!taken.has(path.toLowerCase())) return path
  }
  throw new Error(`MOC 檔名都被佔用：${base}`)
}

/**
 * 把筆記收進 MOC（放進「尚未分章」），再由重建更新 domains。已經收錄就不重複加。
 * 新加的領域依 requests 的順序接在筆記 domains 後面（同一則筆記第一次歸入時，第一個就是主要領域）。
 */
export async function assignToMocs(io: MocIo, requests: readonly AssignRequest[]): Promise<AssignResult> {
  const loaded = await loadMocs(io)
  const mocs = loaded.map(item => item.moc)
  const names = await io.domainNames().catch(() => new Map<string, string>())
  const paths = unique([...io.paths(), ...requests.map(request => request.notePath)])
  const taken = new Set(paths.map(path => path.toLowerCase()))
  const folder = (io.folder ?? DEFAULT_DOMAIN_FOLDER).replace(/^\/+|\/+$/g, '')

  // 依 MOC 分組，同一個 MOC 的多則一次改。
  const byMoc = new Map<string, { file?: MocFile, name: string, notes: string[] }>()
  const failed: AssignRequest[] = []
  const hint = new Map<string, string[]>()
  for (const request of requests) {
    const name = nameOf(request.domain, names, mocs)
    if (!name) {
      failed.push(request)
      continue
    }
    const found = loaded.find(item => item.moc.name === name)
    const key = found?.file.path ?? `new:${name}`
    const group = byMoc.get(key) ?? { file: found?.file, name, notes: [] }
    if (!group.notes.includes(request.notePath)) group.notes.push(request.notePath)
    byMoc.set(key, group)
    const list = hint.get(request.notePath) ?? []
    if (!list.includes(name)) list.push(name)
    hint.set(request.notePath, list)
  }

  const created: string[] = []
  const edits: MocWrite[] = []
  for (const group of byMoc.values()) {
    // 這個 MOC 要補「尚未分章」時用的 C 編號（一個 MOC 最多補一組，重套用時沿用同一個）。
    let chapterId = ''
    const nextChapterId = () => chapterId
    const apply = (raw: string, path: string): string => {
      let content = raw
      for (const notePath of group.notes) {
        const result = addMocEntry(content, { target: entryTargetFor(notePath, paths), newChapterId: nextChapterId }, path)
        content = result.content
      }
      return content
    }
    if (group.file) {
      const moc = parseMoc(group.file.raw, group.file.path)
      if (!moc.unsorted) chapterId = await io.newId('C')
      const after = apply(group.file.raw, group.file.path)
      if (after !== group.file.raw) {
        const path = group.file.path
        edits.push({ path, before: group.file.raw, after, rebase: latest => {
          if (!parseMoc(latest, path).unsorted && !chapterId) return null
          return apply(latest, path)
        } })
      }
      continue
    }
    // 降級：找不到 MOC 檔 → 先建骨架（不覆寫既有檔），再把筆記收進「尚未分章」。
    const path = skeletonPath(folder, group.name, taken)
    taken.add(path.toLowerCase())
    const mocId = await io.newId('M')
    chapterId = await io.newId('C')
    const skeleton = renderMocContent({
      name: group.name, fileName: mocFileName(group.name), mocId, level: 1, children: [], overview: '', chapterId: '', members: [],
    }).content
    const content = apply(skeleton, path)
    try {
      await io.createFile(path, content)
      created.push(path)
      await io.recordMoc?.({ id: mocId, path, name: group.name }).catch(error => console.error('[moc] id_index record failed', error))
    } catch (error) {
      console.error('[moc] create MOC failed', path, error)
      for (const notePath of group.notes) failed.push({ notePath, domain: group.name })
    }
  }

  const committed = edits.length ? await io.commit(edits) : []
  for (const edit of edits) {
    if (committed.some(write => write.path === edit.path)) continue
    const group = [...byMoc.values()].find(item => item.file?.path === edit.path)
    for (const notePath of group?.notes ?? []) failed.push({ notePath, domain: group!.name })
  }
  const rebuild = await rebuildFromMocs(io, { orderHint: hint, extraNotes: requests.map(request => request.notePath), extraMocs: created })
  const mocPaths = [...committed.map(write => write.path), ...created]
  const undo = mocPaths.length
    ? async () => {
        await io.commit(reverse([...committed, ...rebuild.committed]))
        for (const path of created) await io.removeFile?.(path)
        await rebuildFromMocs(io)
      }
    : undefined
  return { mocPaths, created, failed, rebuild, ...(undo ? { undo } : {}) }
}

// ── 從 MOC 拿掉 ─────────────────────────────────────────────

export interface RemoveResult {
  removed: boolean
  rebuild?: RebuildResult
  undo?: () => Promise<void>
}

/** 拿掉某則筆記在某個 MOC（依名稱）的正式收錄，再重建。 */
export async function removeFromMoc(io: MocIo, notePath: string, domainName: string): Promise<RemoveResult> {
  const loaded = await loadMocs(io)
  const found = loaded.find(item => item.moc.name === domainName.trim())
  if (!found) return { removed: false }
  const paths = unique([...io.paths(), notePath])
  const lookup = buildLinkLookup(paths)
  const mocPath = found.file.path
  const matches = (target: string) => resolveWikilinkTargetWithLookup(target, lookup, mocPath) === notePath
  if (!formalEntries(found.moc).some(({ entry }) => matches(entry.target))) return { removed: false }
  const apply = (raw: string) => removeMocEntry(raw, entry => matches(entry.target), mocPath).content
  const after = apply(found.file.raw)
  const committed = await io.commit([{ path: mocPath, before: found.file.raw, after, rebase: latest => apply(latest) }])
  if (!committed.length) return { removed: false }
  const rebuild = await rebuildFromMocs(io)
  return {
    removed: true,
    rebuild,
    undo: async () => {
      await io.commit(reverse([...committed, ...rebuild.committed]))
      await rebuildFromMocs(io)
    },
  }
}

// ── 換人承接（清理的合併、取代） ─────────────────────────────

export interface MembershipTransfer {
  /** 被合併／被取代的筆記。 */
  from: string
  /** 承接的筆記（合併留下的那則、取代的新筆記）。 */
  to: string
}

export interface TransferResult {
  mocPaths: string[]
  rebuild: RebuildResult
}

/**
 * 清理提案接受後：新筆記承接舊筆記在每個 MOC 的正式收錄（原章節、原關係說明；新筆記已在那個 MOC 就只留一條），
 * 舊筆記就此離開那些 MOC（已被取代、合併後封存的預設不再引用；分家清單的現況標記由 69.14 維護，這裡不動引用）。
 * 再重建 domains：承接者原本的順序在前，舊筆記的領域依它原本的順序接在後面。
 */
export async function transferMemberships(io: MocIo, transfers: readonly MembershipTransfer[]): Promise<TransferResult> {
  const loaded = await loadMocs(io)
  const paths = unique([...io.paths(), ...transfers.flatMap(item => [item.from, item.to])])
  const lookup = buildLinkLookup(paths)
  const edits: MocWrite[] = []
  for (const { file } of loaded) {
    const mocPath = file.path
    const resolves = (target: string, notePath: string) => resolveWikilinkTargetWithLookup(target, lookup, mocPath) === notePath
    const apply = (raw: string): string => {
      let content = raw
      for (const { from, to } of transfers) {
        content = replaceMocEntryTarget(content, entry => resolves(entry.target, from), entryTargetFor(to, paths), mocPath, entry => resolves(entry.target, to)).content
      }
      return content
    }
    const after = apply(file.raw)
    if (after !== file.raw) edits.push({ path: mocPath, before: file.raw, after, rebase: latest => apply(latest) })
  }
  const committed = edits.length ? await io.commit(edits) : []
  const notes = await io.listNotes()
  const domainsOf = (path: string) => notes.find(note => note.path === path)?.domains ?? []
  const hint = new Map<string, string[]>()
  for (const { from, to } of transfers) hint.set(to, unique([...(hint.get(to) ?? [...domainsOf(to)]), ...domainsOf(from)]))
  const rebuild = await rebuildFromMocs(io, { orderHint: hint, extraNotes: transfers.map(item => item.to) })
  return { mocPaths: committed.map(write => write.path), rebuild }
}
