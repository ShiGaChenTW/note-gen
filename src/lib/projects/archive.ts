// Fork（almanac ALMNC-89）：結束專案＝封存。定案 1.23：專案結束時封存專案筆記，裡面連到的知識筆記留在各自的領域。
//
// 「專案」在 App 裡有兩處，靠名稱對上（沒有共用的編號）：
// 1. 專案筆記：vault 裡 frontmatter type 為 project 的 Markdown（lib/v3-model/note.ts），標題就是專案名。
// 2. 對話頁的專案分組：store.json 的 threadProjects（lib/threads/projects.ts），秘書新增任務也只掛這裡的專案（ALMNC-87）。
// 另外指揮官的「目前脈絡」也有一份「進行中的專案」（lib/agent-memory/context.ts）。
//
// 結束專案時三處一起動：專案筆記的 status 改成 archived（不刪除、不移動），對話分組記進已封存清單（從進行中清單移走、
// 對話本身與分組都留著），目前脈絡拿掉同名專案。封存紀錄存在 store.json 的 archivedProjects，記下每則筆記原本的狀態與
// 從脈絡拿掉的項目，取消封存時照紀錄還原。知識筆記（就算 frontmatter 寫了 project: 或連到專案筆記）一律不碰。
// 刻意不走垃圾桶（ALMNC-84.2：封存＝不刪除、可取消）。
//
// 這裡是純邏輯與流程；讀寫檔、store.json、資料庫由呼叫端注入（預設實作在 archive-io.ts）。
import type { ContextItem, SharedContext } from '@/lib/agent-memory/context'
import { CONTEXT_MAX_PROJECTS } from '@/lib/agent-memory/context'
import { NOTE_STATUSES, parseV3Note, writeV3NoteFields, type NoteStatus } from '@/lib/v3-model/note'
import { normalizeProjectName } from '@/lib/threads/projects'

export const ARCHIVED_PROJECTS_KEY = 'archivedProjects'

export interface ArchivedProjectNote {
  /** vault 相對路徑。 */
  path: string
  /** 封存前的狀態；null＝原本沒填。 */
  previousStatus: NoteStatus | null
}

export interface ArchivedProject {
  /** 專案名（normalizeProjectName 之後）。 */
  name: string
  archivedAt: number
  /** 這次封存的專案筆記（原本就是封存的不算，取消封存也不會動它們）。 */
  notes: ArchivedProjectNote[]
  /** 從目前脈絡拿掉的項目，取消封存時放回去。 */
  context: ContextItem[]
}

/** 專案名 → 封存紀錄。 */
export type ArchivedProjectMap = Record<string, ArchivedProject>

/** 比對專案名：整理空白後不分大小寫。 */
export function sameProjectName(a: string, b: string): boolean {
  const left = normalizeProjectName(a).toLowerCase()
  return !!left && left === normalizeProjectName(b).toLowerCase()
}

export function isProjectArchived(map: ArchivedProjectMap, name: string): boolean {
  return Object.keys(map).some(key => sameProjectName(key, name))
}

/** 已封存的專案名（給 groupThreads／listProjects 用）。 */
export function archivedNames(map: ArchivedProjectMap): Set<string> {
  return new Set(Object.keys(map))
}

/** 依封存時間排（新的在前），供「已封存的專案」區塊。 */
export function listArchivedProjects(map: ArchivedProjectMap): ArchivedProject[] {
  return Object.values(map).sort((a, b) => b.archivedAt - a.archivedAt || a.name.localeCompare(b.name))
}

function sanitizeNote(value: unknown): ArchivedProjectNote | null {
  if (!value || typeof value !== 'object') return null
  const { path, previousStatus } = value as Record<string, unknown>
  if (typeof path !== 'string' || !path.trim()) return null
  const status = typeof previousStatus === 'string' && (NOTE_STATUSES as readonly string[]).includes(previousStatus) ? previousStatus as NoteStatus : null
  return { path, previousStatus: status }
}

function sanitizeContextItem(value: unknown): ContextItem | null {
  if (!value || typeof value !== 'object') return null
  const { title, link } = value as Record<string, unknown>
  if (typeof title !== 'string' || !title.trim()) return null
  return typeof link === 'string' && link.trim() ? { title, link } : { title }
}

/** 讀回 store.json 的值：格式不對的丟掉。 */
export function sanitizeArchivedProjects(value: unknown): ArchivedProjectMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: ArchivedProjectMap = {}
  for (const raw of Object.values(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const name = typeof record.name === 'string' ? normalizeProjectName(record.name) : ''
    if (!name) continue
    next[name] = {
      name,
      archivedAt: typeof record.archivedAt === 'number' && Number.isFinite(record.archivedAt) ? record.archivedAt : 0,
      notes: Array.isArray(record.notes) ? record.notes.map(sanitizeNote).filter((note): note is ArchivedProjectNote => !!note) : [],
      context: Array.isArray(record.context) ? record.context.map(sanitizeContextItem).filter((item): item is ContextItem => !!item) : [],
    }
  }
  return next
}

// ── 找專案筆記 ──────────────────────────────────────────────

/** 筆記索引裡需要的欄位（stores/vault-index 的 IndexedNote）。 */
export interface ProjectNoteCandidate {
  path: string
  frontmatter: Record<string, unknown> | null
  headings: ReadonlyArray<{ level: number, text: string }>
}

/** 索引項目的標題：frontmatter title → 第一個 H1 → 檔名（同 v3-model noteTitle）。 */
function candidateTitle(note: ProjectNoteCandidate): string {
  const title = note.frontmatter?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  const heading = note.headings.find(item => item.level === 1)?.text.trim()
  if (heading) return heading
  return note.path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
}

/** 標題等於專案名的專案筆記（type: project）。知識、日誌筆記就算寫了 project: 也不算。 */
export function findProjectNotes(notes: Iterable<ProjectNoteCandidate>, name: string): string[] {
  const found: string[] = []
  for (const note of notes) {
    const type = note.frontmatter?.type
    if (typeof type !== 'string' || type.trim().toLowerCase() !== 'project') continue
    if (sameProjectName(candidateTitle(note), name)) found.push(note.path)
  }
  return found.sort()
}

// ── 改寫單則筆記（純函式） ────────────────────────────────────

function statusOf(raw: string): NoteStatus | null | undefined {
  try {
    return parseV3Note(raw).fields.status ?? null
  } catch {
    // frontmatter 壞掉：不動這則
    return undefined
  }
}

/** 封存一則專案筆記：status 改成 archived。已經封存或 frontmatter 壞掉就回傳 null（不改）。 */
export function archiveNoteRaw(raw: string): string | null {
  const status = statusOf(raw)
  if (status === undefined || status === 'archived') return null
  return writeV3NoteFields(raw, { status: 'archived' })
}

/** 取消封存：目前仍是 archived 才改回原本的狀態（原本沒填就拿掉 status）；否則回傳 null（使用者已經自己改過，不蓋掉）。 */
export function restoreNoteRaw(raw: string, previousStatus: NoteStatus | null): string | null {
  if (statusOf(raw) !== 'archived') return null
  return writeV3NoteFields(raw, { status: previousStatus })
}

// ── 目前脈絡 ────────────────────────────────────────────────

/** 從脈絡拿掉同名專案，回傳剩下的與拿掉的。 */
export function contextWithoutProject(context: SharedContext, name: string): { context: SharedContext, removed: ContextItem[] } {
  const removed = context.projects.filter(item => sameProjectName(item.title, name))
  if (removed.length === 0) return { context, removed }
  return { context: { ...context, projects: context.projects.filter(item => !sameProjectName(item.title, name)) }, removed }
}

/** 把拿掉的項目放回脈絡最後；已經有同名的不重複放，超過上限的放不回去（不擠掉別的專案）。 */
export function contextWithProject(context: SharedContext, items: readonly ContextItem[]): SharedContext {
  const projects = [...context.projects]
  for (const item of items) {
    if (projects.length >= CONTEXT_MAX_PROJECTS) break
    if (projects.some(existing => sameProjectName(existing.title, item.title))) continue
    projects.push(item)
  }
  return projects.length === context.projects.length ? context : { ...context, projects }
}

// ── 流程 ────────────────────────────────────────────────────

export interface ProjectArchiveDeps {
  now: () => number
  /** 標題等於專案名的專案筆記路徑。 */
  findProjectNotes: (name: string) => Promise<string[]>
  /**
   * 改寫一則筆記：rewrite 拿最新內容，回傳新內容或 null（不改）。
   * 回傳改寫前的內容；沒改就回傳 null。讀寫失敗丟錯。
   */
  rewriteNote: (path: string, rewrite: (raw: string) => string | null) => Promise<string | null>
  getContext: () => Promise<SharedContext>
  saveContext: (context: SharedContext) => Promise<void>
}

export interface ArchiveOutcome {
  record: ArchivedProject
  /** 讀寫失敗、沒封存到的筆記。 */
  failed: string[]
}

/** 結束專案：封存同名專案筆記、從脈絡拿掉，回傳封存紀錄（由呼叫端存進 archivedProjects）。 */
export async function archiveProject(name: string, deps: ProjectArchiveDeps): Promise<ArchiveOutcome> {
  const project = normalizeProjectName(name)
  if (!project) throw new Error('專案名不能是空的')
  const notes: ArchivedProjectNote[] = []
  const failed: string[] = []
  for (const path of await deps.findProjectNotes(project)) {
    try {
      const before = await deps.rewriteNote(path, archiveNoteRaw)
      if (before !== null) notes.push({ path, previousStatus: statusOf(before) ?? null })
    } catch (error) {
      console.warn('[project-archive] 專案筆記沒有封存：', path, error)
      failed.push(path)
    }
  }
  let removed: ContextItem[] = []
  try {
    const current = await deps.getContext()
    const next = contextWithoutProject(current, project)
    if (next.removed.length > 0) {
      await deps.saveContext(next.context)
      removed = next.removed
    }
  } catch (error) {
    // 脈絡寫不進去不擋結束專案；指揮官下次整理脈絡時會再看到
    console.warn('[project-archive] 目前脈絡沒有更新：', error)
  }
  return { record: { name: project, archivedAt: deps.now(), notes, context: removed }, failed }
}

/** 取消封存：照紀錄把專案筆記改回原本的狀態、把脈絡項目放回去。回傳沒還原到的筆記。 */
export async function restoreProject(record: ArchivedProject, deps: Omit<ProjectArchiveDeps, 'findProjectNotes' | 'now'>): Promise<{ failed: string[] }> {
  const failed: string[] = []
  for (const note of record.notes) {
    try {
      await deps.rewriteNote(note.path, raw => restoreNoteRaw(raw, note.previousStatus))
    } catch (error) {
      // 筆記被搬走或刪掉：跳過，其餘照常還原
      console.warn('[project-archive] 專案筆記沒有還原：', note.path, error)
      failed.push(note.path)
    }
  }
  if (record.context.length > 0) {
    try {
      const current = await deps.getContext()
      const next = contextWithProject(current, record.context)
      if (next !== current) await deps.saveContext(next)
    } catch (error) {
      console.warn('[project-archive] 目前脈絡沒有放回：', error)
    }
  }
  return { failed }
}
