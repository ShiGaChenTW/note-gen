// Fork（almanac ALMNC-69.9）：把操作算成實際的檔案動作。先在一層虛擬檔案上依序套用（同一批的後一筆看得到前一筆的結果），
// 每筆操作依編號解析路徑（id_index；查不到才用記錄當下的路徑），算出寫入／搬動動作；真正寫檔由 applyActions 經注入的 writer 做。
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import { addMocEntry, moveMocEntry, removeMocEntry, renameMocChapter, sameTarget, setMocEntryRelation, type ChapterRef } from '@/lib/moc/edit'
import { formalEntries, parseMoc, type MocEntry } from '@/lib/moc/parse'
import { entryTargetFor } from '@/lib/moc/service'
import type { OpSpec } from './types'

/** 讀筆記庫與系統索引（App 用 Tauri；測試用記憶體）。 */
export interface OpsFs {
  read: (path: string) => Promise<string | null>
  /** 身分編號 → 目前路徑（id_index）；查不到是 null。 */
  resolveId: (id: string) => Promise<string | null>
  /** 筆記庫全部檔案路徑（解析收錄連結用）。 */
  paths: () => Promise<readonly string[]>
  /** 收回原章節但那一章已經不在、又沒有「尚未分章」時，補一組要用的 C 編號。 */
  newId: (kind: 'C') => Promise<string>
}

export type OpAction =
  | { type: 'write', path: string, before: string | null, after: string | null }
  | { type: 'move', from: string, to: string }

/** 寫檔（App：協調寫入、建新檔、刪檔、搬檔；測試：記憶體）。內容和 before 不同時要丟例外，不覆蓋。 */
export interface OpsWriter {
  write: (path: string, before: string | null, after: string | null) => Promise<void>
  move: (from: string, to: string) => Promise<void>
}

export interface OpsPlan {
  actions: OpAction[]
  /** 實際套用的操作（補上執行時才知道的事，例如收進哪一章、是否補了尚未分章）。 */
  specs: OpSpec[]
  /** 每筆操作套用後它動到的檔案內容（null＝不存在），依操作順序。 */
  touched: Array<Record<string, string | null>>
  /** 全部套用後每個動到的檔案內容。 */
  final: Map<string, string | null>
}

class Overlay {
  private files = new Map<string, string | null>()
  private ids = new Map<string, string>()
  private basePaths: readonly string[] | null = null

  constructor(private fs: OpsFs) {}

  async read(path: string): Promise<string | null> {
    if (this.files.has(path)) return this.files.get(path) ?? null
    const value = await this.fs.read(path)
    this.files.set(path, value)
    return value
  }

  set(path: string, value: string | null) {
    this.files.set(path, value)
  }

  async resolve(id: string | undefined, hint: string): Promise<string> {
    if (!id) return hint
    const moved = this.ids.get(id)
    if (moved) return moved
    return (await this.fs.resolveId(id).catch(() => null)) ?? hint
  }

  remember(id: string | undefined, path: string) {
    if (id) this.ids.set(id, path)
  }

  async paths(): Promise<string[]> {
    this.basePaths ??= await this.fs.paths()
    const set = new Set(this.basePaths)
    for (const [path, value] of this.files) {
      if (value === null) set.delete(path)
      else set.add(path)
    }
    return [...set]
  }
}

function entryMatcher(notePath: string, mocPath: string, paths: readonly string[]): (entry: MocEntry) => boolean {
  const lookup = buildLinkLookup(paths)
  const target = entryTargetFor(notePath, paths)
  return entry => resolveWikilinkTargetWithLookup(entry.target, lookup, mocPath) === notePath || sameTarget(entry.target, target)
}

async function chapterIdSupplier(raw: string, path: string, fs: OpsFs): Promise<() => string> {
  const id = parseMoc(raw, path).unsorted ? '' : await fs.newId('C')
  return () => id
}

/** 拿掉空的「尚未分章」那一組（C 編號相同才拿；還有收錄就不動）。 */
export function dropEmptyUnsorted(raw: string, chapterId: string, path?: string): string {
  const unsorted = parseMoc(raw, path).unsorted
  if (!unsorted || unsorted.id !== chapterId || unsorted.entries.length) return raw
  const lines = raw.split('\n')
  const blank = (line: string | undefined) => line !== undefined && !line.replace(/\r$/, '').trim()
  let start = unsorted.line
  let end = unsorted.endLine
  // 補的時候前面多了一行空白：一起拿掉（後面的空白留給下一個區塊）。
  if (blank(lines[start - 1]) && (end >= lines.length || blank(lines[end - 1]) || blank(lines[end]))) start--
  while (end - 1 > start && blank(lines[end - 1])) end--
  if (end < lines.length && blank(lines[end]) && blank(lines[start - 1])) end++
  lines.splice(start, end - start)
  return lines.join('\n')
}

/** 依序套用到虛擬檔案層，回傳要做的檔案動作。不寫檔。 */
export async function planOps(ops: readonly OpSpec[], fs: OpsFs): Promise<OpsPlan> {
  const overlay = new Overlay(fs)
  const actions: OpAction[] = []
  const specs: OpSpec[] = []
  const touched: Array<Record<string, string | null>> = []
  const final = new Map<string, string | null>()

  const write = async (path: string, after: string | null, record: Record<string, string | null>) => {
    const before = await overlay.read(path)
    record[path] = after
    if (before === after) return
    actions.push({ type: 'write', path, before, after })
    overlay.set(path, after)
    final.set(path, after)
  }

  for (const original of ops) {
    let op = original
    const record: Record<string, string | null> = {}
    switch (op.kind) {
      case 'note.create':
      case 'domain.create': {
        const path = await overlay.resolve(op.kind === 'note.create' ? op.noteId : op.mocId, op.path)
        await write(path, op.content, record)
        overlay.remember(op.kind === 'note.create' ? op.noteId : op.mocId, path)
        break
      }
      case 'note.delete':
      case 'domain.remove': {
        const path = await overlay.resolve(op.kind === 'note.delete' ? op.noteId : op.mocId, op.path)
        await write(path, null, record)
        break
      }
      case 'note.edit': {
        const path = await overlay.resolve(op.noteId, op.path)
        await write(path, op.after, record)
        break
      }
      case 'note.move': {
        const from = await overlay.resolve(op.noteId, op.from)
        const content = await overlay.read(from)
        if (content === null || from === op.to) {
          if (content !== null) record[from] = content
          break
        }
        actions.push({ type: 'move', from, to: op.to })
        overlay.set(from, null)
        overlay.set(op.to, content)
        overlay.remember(op.noteId, op.to)
        final.set(from, null)
        final.set(op.to, content)
        record[from] = null
        record[op.to] = content
        break
      }
      case 'moc.chapter.rename': {
        // Fork（almanac ALMNC-69.10）：依 C 編號改章節標題（找不到再依舊名稱）。
        const mocPath = await overlay.resolve(op.mocId, op.mocPath)
        const raw = await overlay.read(mocPath)
        if (raw === null) break
        const content = renameMocChapter(raw, { ...(op.chapterId ? { id: op.chapterId } : {}), title: op.before }, op.after, mocPath).content
        await write(mocPath, content, record)
        break
      }
      case 'moc.entry.add':
      case 'moc.entry.remove':
      case 'moc.entry.move':
      case 'moc.entry.relation': {
        const mocPath = await overlay.resolve(op.mocId, op.mocPath)
        const notePath = await overlay.resolve(op.noteId, op.notePath)
        const raw = await overlay.read(mocPath)
        if (raw === null) break
        const paths = await overlay.paths()
        const matches = entryMatcher(notePath, mocPath, paths)
        let content = raw
        if (op.kind === 'moc.entry.relation') {
          content = setMocEntryRelation(raw, matches, op.after, mocPath).content
        } else if (op.kind === 'moc.entry.remove') {
          content = removeMocEntry(raw, matches, mocPath).content
          if (op.createdChapter && op.chapterId) content = dropEmptyUnsorted(content, op.chapterId, mocPath)
        } else if (op.kind === 'moc.entry.add') {
          const newChapterId = await chapterIdSupplier(raw, mocPath, fs)
          const entry = { target: entryTargetFor(notePath, paths), ...(op.relation ? { relation: op.relation } : {}), newChapterId }
          const chapter: ChapterRef = op.chapterId ? { id: op.chapterId } : { unsorted: true }
          let result = addMocEntry(raw, { ...entry, chapter }, mocPath)
          // 原本那一章已經不在：收進尚未分章（不丟掉這條收錄）。
          if (result.reason === 'no-chapter') result = addMocEntry(raw, { ...entry, chapter: { unsorted: true } }, mocPath)
          content = result.content
          // 記下實際收進哪一章（反向依這個 C 編號；補了尚未分章時反向一起拿掉）。
          if (result.changed) {
            const landed = formalEntries(parseMoc(content, mocPath)).find(({ entry: item }) => matches(item))?.chapter
            const created = Boolean(landed?.unsorted && !parseMoc(raw, mocPath).unsorted)
            if (landed?.id) op = { ...op, chapterId: landed.id, ...(created ? { createdChapter: true } : {}) }
          }
        } else {
          const newChapterId = await chapterIdSupplier(raw, mocPath, fs)
          const to: ChapterRef = op.toChapterId ? { id: op.toChapterId } : { unsorted: true }
          let result = moveMocEntry(raw, matches, to, { newChapterId }, mocPath)
          if (result.reason === 'no-chapter') result = moveMocEntry(raw, matches, { unsorted: true }, { newChapterId }, mocPath)
          content = result.content
        }
        await write(mocPath, content, record)
        break
      }
    }
    touched.push(record)
    specs.push(op)
  }
  return { actions, specs, touched, final }
}

/** 依序寫檔；中途失敗時把已寫的倒回去（盡力），再丟出原本的錯誤。 */
export async function applyActions(actions: readonly OpAction[], writer: OpsWriter): Promise<void> {
  const done: OpAction[] = []
  try {
    for (const action of actions) {
      if (action.type === 'write') await writer.write(action.path, action.before, action.after)
      else await writer.move(action.from, action.to)
      done.push(action)
    }
  } catch (error) {
    for (const action of done.reverse()) {
      try {
        if (action.type === 'write') await writer.write(action.path, action.after, action.before)
        else await writer.move(action.to, action.from)
      } catch { /* 盡力倒回；剩下的由比較卡處理。 */ }
    }
    throw error
  }
}
