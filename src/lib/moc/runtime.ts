// Fork（almanac ALMNC-69.7）：MOC 流程（service.ts）的 App I/O：筆記庫索引找 MOC 與筆記、Tauri 讀檔、編輯器協調寫入、
// note.db 的 domains 表與系統索引。寫入端（檯面歸入領域、提案、領域提案、超過上限卡）與 MocRebuildService 都經過這裡。
import type { OpSpec } from '@/lib/ops/types'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import { formalEntries, parseMoc } from './parse'
import { commitNoteWrites } from '@/lib/daily/coordinated-write'
import { readNote, removeNote, writeNote } from '@/lib/daily/note-io'
import { newId } from '@/lib/v3-model/identity'
import type { RecordInput } from '@/lib/ops/service'
import type { LoggedContext } from '@/lib/ops/runtime'
import type { OpRecord } from '@/lib/ops/types'
import useMocStore from '@/stores/moc'
import useVaultIndexStore from '@/stores/vault-index'
import { assignToMocs, rebuildFromMocs, removeFromMoc, transferMemberships, type AssignRequest, type AssignResult, type MembershipTransfer, type MocIo, type RebuildOptions, type RebuildResult, type RemoveResult, type TransferResult } from './service'

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).trim()).filter(Boolean)
}

function isMocFrontmatter(frontmatter: Record<string, unknown> | null): boolean {
  return typeof frontmatter?.kind === 'string' && frontmatter.kind.trim().toLowerCase() === 'domain'
}

/**
 * Fork（almanac ALMNC-69.10）：重建與寫入端讀 MOC 時改用的內容（reconcile-runtime 每次比對後設定）：
 * 整批檢查還沒確認的 MOC → 上次已知狀態（null＝系統沒看過的 MOC，先不算）；收錄行格式壞了或斷鏈但保留原歸屬 → 有效內容。
 */
let mocOverrides = new Map<string, string | null>()

export function setMocOverrides(next: ReadonlyMap<string, string | null>): void {
  mocOverrides = new Map(next)
}

export function createMocIo(): MocIo {
  return {
    listMocFiles: async (extra = []) => {
      const notes = useVaultIndexStore.getState().notes
      const paths = new Set([...[...notes.values()].filter(note => isMocFrontmatter(note.frontmatter)).map(note => note.path), ...extra])
      const files = []
      for (const path of paths) {
        if (mocOverrides.has(path)) {
          const override = mocOverrides.get(path)
          if (override !== null && override !== undefined) files.push({ path, raw: override })
          continue
        }
        const raw = await readNote(path).catch(() => null)
        if (raw !== null) files.push({ path, raw })
      }
      return files
    },
    listNotes: async () => [...useVaultIndexStore.getState().notes.values()]
      .filter(note => note.frontmatter && !isMocFrontmatter(note.frontmatter))
      .map(note => ({ path: note.path, domains: strings(note.frontmatter?.domains) })),
    paths: () => [...useVaultIndexStore.getState().notes.keys()],
    readFile: path => readNote(path),
    commit: async writes => {
      const done = []
      for (const write of writes) {
        try {
          done.push(...await commitNoteWrites([write], { requireExisting: true }))
        } catch (error) {
          console.warn('[moc] 寫入跳過（下次再處理）：', write.path, error)
        }
      }
      return done
    },
    createFile: (path, content) => writeNote(path, content, { createNew: true }),
    removeFile: path => removeNote(path),
    domainNames: async () => {
      const { listDomains } = await import('@/db/v3-domains')
      const map = new Map<string, string>()
      for (const domain of await listDomains()) {
        map.set(domain.id, domain.name.trim())
        if (!map.has(domain.name.trim())) map.set(domain.name.trim(), domain.name.trim())
      }
      return map
    },
    newId: async kind => {
      const { idExists } = await import('@/db/id-index')
      return newId(kind, new Date(), { exists: idExists })
    },
    recordMoc: async ({ id, path, name }) => {
      const { recordId } = await import('@/db/id-index')
      await recordId({ id, kind: 'M', path, name })
    },
  }
}

/** 重建後的共同收尾：更新快取（領域頁、工作台）、domains 表由 MOC 同步。 */
export async function settleMocRebuild(result: RebuildResult): Promise<void> {
  try {
    const { syncDomainsTableFromMocs } = await import('@/db/v3-domains')
    const plan = await syncDomainsTableFromMocs(result.mocs)
    if (plan.skipped.length) console.debug('[moc] 還沒有 M 編號的 MOC，domains 表下次再補：', plan.skipped)
  } catch (error) {
    console.warn('[moc] domains 表同步失敗：', error)
  }
  useMocStore.getState().setResult({ mocs: result.mocs, overLimit: result.overLimit })
}

let mocQueue: Promise<unknown> = Promise.resolve()

/** 避免索引觸發的重建在領域撤回期間讀到舊 MOC。 */
export function serializeMocChange<T>(change: () => Promise<T>): Promise<T> {
  const next = mocQueue.then(change)
  mocQueue = next.catch(() => undefined)
  return next
}

/** 由 MOC 重建全部筆記的 domains。筆記庫索引還沒準備好時回傳 null。 */
export async function runMocRebuild(options: RebuildOptions = {}): Promise<RebuildResult | null> {
  return serializeMocChange(async () => {
    if (useVaultIndexStore.getState().status !== 'ready') return null
    const result = await rebuildFromMocs(createMocIo(), options)
    await settleMocRebuild(result)
    const { trackMocPositions, refreshMocSplitStatuses } = await import('./branch-runtime')
    await trackMocPositions(result.mocs).catch(error => console.warn('[moc] positions not saved:', error))
    await refreshMocSplitStatuses(result.mocs, mocOverrides).catch(error => console.warn('[moc] split status not refreshed:', error))
    return result
  })
}

/** Fork（almanac ALMNC-69.9）：寫入端帶上發起情境時，MOC 的改動記成以編號描述的操作（ops），復原改以 ops 為準（7 天、版本檢查）。 */
export interface MocOpOptions {
  ops?: LoggedContext
}

async function noteRef(notePath: string): Promise<{ noteId?: string, noteTitle: string, notePath: string }> {
  const { idOfContent, titleOfPath } = await import('@/lib/ops/runtime')
  const noteId = idOfContent(await readNote(notePath).catch(() => null))
  return { ...(noteId ? { noteId } : {}), noteTitle: titleOfPath(notePath), notePath }
}

/** 收進 MOC 的結果 → 操作（新建的 MOC 記成立領域，收進既有 MOC 的記 moc.entry.add）。 */
async function assignInputs(result: AssignResult): Promise<RecordInput[]> {
  const inputs: RecordInput[] = result.createdMocs.map(moc => ({
    spec: { kind: 'domain.create', mocId: moc.mocId, name: moc.name, path: moc.path, content: moc.content },
  }))
  for (const entry of result.added) {
    inputs.push({
      spec: {
        kind: 'moc.entry.add', ...await noteRef(entry.notePath),
        ...(entry.mocId ? { mocId: entry.mocId } : {}), mocName: entry.mocName, mocPath: entry.mocPath,
        ...(entry.chapterId ? { chapterId: entry.chapterId } : {}), ...(entry.createdChapter ? { createdChapter: true } : {}),
      },
      after: { [entry.mocPath]: entry.mocAfter },
    })
  }
  return inputs
}

async function withOps<T extends object>(result: T, inputs: RecordInput[], context?: LoggedContext): Promise<T & { ops?: OpRecord[], undo?: () => Promise<void> }> {
  if (!context || !inputs.length) return result
  const { recordOps, undoRecords } = await import('@/lib/ops/runtime')
  const ops = await recordOps(inputs, context)
  const undo = undoRecords(ops)
  return undo ? { ...result, ops, undo: async () => { await undo() } } : result
}

/** 把筆記收進領域的 MOC（尚未分章），再重建 domains。domains 是領域名稱或舊 dom_ id，依序（第一個是主要）。 */
export async function assignNoteToDomains(notePath: string, domains: readonly string[], options: MocOpOptions = {}): Promise<(AssignResult & { ops?: OpRecord[] }) | null> {
  const requests: AssignRequest[] = domains.map(domain => ({ notePath, domain }))
  if (!requests.length) return null
  const result = await assignToMocs(createMocIo(), requests)
  await settleMocRebuild(result.rebuild)
  if (result.failed.length) console.warn('[moc] 沒有收進 MOC：', result.failed)
  return withOps(result, options.ops ? await assignInputs(result) : [], options.ops)
}

/** 超過上限卡：拿掉這則筆記在這個領域 MOC 的收錄。 */
export async function removeNoteFromDomain(notePath: string, domainName: string, options: MocOpOptions = {}): Promise<RemoveResult & { ops?: OpRecord[] }> {
  const result = await removeFromMoc(createMocIo(), notePath, domainName)
  if (result.rebuild) await settleMocRebuild(result.rebuild)
  const entry = result.entry
  const inputs: RecordInput[] = options.ops && entry ? [{
    spec: {
      kind: 'moc.entry.remove', ...await noteRef(notePath), ...(entry.mocId ? { mocId: entry.mocId } : {}),
      mocName: entry.mocName, mocPath: entry.mocPath, ...(entry.chapterId ? { chapterId: entry.chapterId } : {}),
      ...(entry.relation ? { relation: entry.relation } : {}),
    },
    after: { [entry.mocPath]: entry.mocAfter },
  }] : []
  return withOps(result, inputs, options.ops)
}

/** 清理提案接受後：新筆記承接被合併／被取代筆記的 MOC 收錄，再重建 domains。 */
export async function transferNoteMemberships(transfers: readonly MembershipTransfer[], options: MocOpOptions = {}): Promise<(TransferResult & { ops?: OpRecord[] }) | null> {
  if (!transfers.length) return null
  const result = await transferMemberships(createMocIo(), transfers)
  await settleMocRebuild(result.rebuild)
  if (!options.ops) return result
  // 換人承接一次改好幾條收錄：以 MOC 全文前後記成內容修改（復原＝寫回前版本，同樣先做版本檢查）。
  const { idOfContent, titleOfPath } = await import('@/lib/ops/runtime')
  const inputs: RecordInput[] = result.committed.map(write => {
    const mocId = idOfContent(write.before)
    return { spec: { kind: 'note.edit', ...(mocId ? { noteId: mocId } : {}), path: write.path, title: titleOfPath(write.path), before: write.before, after: write.after } }
  })
  return withOps(result, inputs, options.ops)
}

/** Ops 套用或復原領域的新增／移除時，同步快取，並重讀受影響的收錄筆記。 */
export async function reconcileDomainIndexes(specs: readonly OpSpec[]): Promise<RebuildOptions> {
  const preferredOrder = new Map<string, readonly string[]>()
  const extraMocs: string[] = []
  const retiredDomains: string[] = []
  const extraNotes: string[] = []
  const links = buildLinkLookup([...useVaultIndexStore.getState().notes.keys()])
  for (const spec of specs) {
    if (spec.kind === 'note.edit') {
      for (const item of spec.domainOrder ?? []) {
        preferredOrder.set(item.path, item.after)
        extraNotes.push(item.path)
      }
    }
    if (spec.kind !== 'domain.create' && spec.kind !== 'domain.remove') continue
    if (spec.kind === 'domain.create') extraMocs.push(spec.path)
    else retiredDomains.push(spec.name)
    const moc = parseMoc(spec.content, spec.path)
    for (const { entry } of formalEntries(moc)) {
      const path = resolveWikilinkTargetWithLookup(entry.target, links, spec.path)
      if (path) extraNotes.push(path)
    }
    if (!spec.mocId) continue
    const { recordId, retireMocId } = await import('@/db/id-index')
    if (spec.kind === 'domain.create') await recordId({ id: spec.mocId, kind: 'M', path: spec.path, name: spec.name })
    else {
      const { removeDomainCache } = await import('@/db/v3-domains')
      await Promise.all([removeDomainCache(spec.mocId), retireMocId(spec.mocId)])
    }
  }
  return { extraMocs, retiredDomains, extraNotes, preferredOrder }
}
