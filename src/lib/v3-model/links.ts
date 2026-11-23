// Fork（almanac ALMNC-54.1）：資料源 ↔ 產出（筆記、行動）的雙向查詢。
// 一則資料源可拆成多則筆記，多則資料源也可合成一則筆記；兩個方向都查得到。
// 連結的權威紀錄是 source_outputs 表；筆記 frontmatter 的 sources 是同一份關係寫在筆記這端的副本，
// 查「筆記的來源」時兩邊取聯集，任何一邊漏記都還找得到。

// Fork（almanac ALMNC-69.4）：target_ref 改存身分編號——筆記是 N 編號、行動是「N-…#提案 id」。遷移前的資料與還沒遷移的
// 新寫入仍是 vault 相對路徑（或「路徑#提案 id」），所以兩種都要認；編號經系統索引 id_index 解析回路徑，找不到就退回原值。
import { isId } from './identity'

export type OutputTargetType = 'note' | 'action'

export interface SourceOutput {
  sourceId: string
  targetType: OutputTargetType
  /** 筆記：N 編號（舊資料是 vault 相對路徑）；行動：「N 編號或每日筆記路徑#提案 id」。 */
  targetRef: string
  /** Fork（almanac ALMNC-69.4）：target_ref 解析成的 vault 相對路徑（編號經 id_index 換回；找不到時沒有）。 */
  targetPath?: string
  createdAt: number
}

export interface SourceOutputRow {
  sourceId: string
  targetType: string
  targetRef: string
  /** id_index 查到的路徑（left join，沒有就是 null）。 */
  indexedPath?: string | null
  createdAt: number
}

export interface ResolvedTargetRef {
  /** 編號部分（target_ref 是編號時才有）。 */
  id?: string
  /** vault 相對路徑；編號在系統索引找不到時沒有。 */
  path?: string
  /** 「#」後面的部分（行動的提案 id）。 */
  anchor?: string
  /** 編號找不到路徑（降級：呼叫端只能顯示編號）。 */
  unresolved: boolean
}

/** 拆開 target_ref，編號用 pathOfId 換回路徑；路徑形式照原樣回傳。 */
export function resolveTargetRef(ref: string, pathOfId: (id: string) => string | null | undefined): ResolvedTargetRef {
  const index = ref.indexOf('#')
  const base = index < 0 ? ref : ref.slice(0, index)
  const anchor = index < 0 ? undefined : ref.slice(index + 1)
  if (!isId(base)) return { path: base || undefined, ...(anchor !== undefined ? { anchor } : {}), unresolved: false }
  let path: string | undefined
  try {
    path = pathOfId(base) || undefined
  } catch {
    path = undefined
  }
  return { id: base, ...(path ? { path } : {}), ...(anchor !== undefined ? { anchor } : {}), unresolved: !path }
}

export function isOutputTargetType(value: unknown): value is OutputTargetType {
  return value === 'note' || value === 'action'
}

export function sourceOutputFromRow(row: SourceOutputRow): SourceOutput {
  if (!isOutputTargetType(row.targetType)) throw new Error(`未知的產出類型：${row.targetType}`)
  const { path } = resolveTargetRef(row.targetRef, () => row.indexedPath)
  return { sourceId: row.sourceId, targetType: row.targetType, targetRef: row.targetRef, ...(path ? { targetPath: path } : {}), createdAt: row.createdAt }
}

export interface SourceOutputs {
  notes: string[]
  actions: string[]
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
}

/** 資料源 → 它產出的筆記路徑與行動 id。筆記優先用解析回的路徑，找不到路徑時退回 target_ref 本身（編號）。 */
export function outputsOfSource(sourceId: string, links: readonly SourceOutput[]): SourceOutputs {
  const own = links.filter(link => link.sourceId === sourceId)
  return {
    notes: unique(own.filter(link => link.targetType === 'note').map(link => link.targetPath ?? link.targetRef)),
    actions: unique(own.filter(link => link.targetType === 'action').map(link => link.targetRef)),
  }
}

/** 筆記可以被認出來的 target_ref：路徑（舊資料）、N 編號（遷移後）。 */
export type NoteRefs = string | readonly string[]

function pointsToNote(link: SourceOutput, note: NoteRefs): boolean {
  if (link.targetType !== 'note') return false
  const refs = typeof note === 'string' ? [note] : note
  return refs.includes(link.targetRef) || (!!link.targetPath && refs.includes(link.targetPath))
}

/** 筆記 → 來源資料源 id：frontmatter 的 sources 在前（保留作者排序），再補上連結表裡多出來的。 */
export function sourcesOfNote(note: NoteRefs, frontmatterSources: readonly string[], links: readonly SourceOutput[]): string[] {
  return unique([
    ...frontmatterSources,
    ...links.filter(link => pointsToNote(link, note)).map(link => link.sourceId),
  ])
}

/** 行動 → 來源資料源 id。 */
export function sourcesOfAction(actionId: string, links: readonly SourceOutput[]): string[] {
  return unique(links.filter(link => link.targetType === 'action' && link.targetRef === actionId).map(link => link.sourceId))
}

/**
 * 比對筆記 frontmatter 與連結表，列出兩邊不一致的地方，供修復用：
 * missingLinks＝frontmatter 有、連結表沒有；missingInFrontmatter＝連結表有、frontmatter 沒有。
 */
export function noteLinkDrift(note: NoteRefs, frontmatterSources: readonly string[], links: readonly SourceOutput[]) {
  const linked = new Set(links.filter(link => pointsToNote(link, note)).map(link => link.sourceId))
  const declared = new Set(frontmatterSources)
  return {
    missingLinks: Array.from(declared).filter(id => !linked.has(id)),
    missingInFrontmatter: Array.from(linked).filter(id => !declared.has(id)),
  }
}
