// Fork（almanac ALMNC-54.1）：資料源 ↔ 產出（筆記、行動）的雙向查詢。
// 一則資料源可拆成多則筆記，多則資料源也可合成一則筆記；兩個方向都查得到。
// 連結的權威紀錄是 source_outputs 表；筆記 frontmatter 的 sources 是同一份關係寫在筆記這端的副本，
// 查「筆記的來源」時兩邊取聯集，任何一邊漏記都還找得到。

export type OutputTargetType = 'note' | 'action'

export interface SourceOutput {
  sourceId: string
  targetType: OutputTargetType
  /** 筆記：vault 相對路徑；行動：任務或行程的 id。 */
  targetRef: string
  createdAt: number
}

export interface SourceOutputRow {
  sourceId: string
  targetType: string
  targetRef: string
  createdAt: number
}

export function isOutputTargetType(value: unknown): value is OutputTargetType {
  return value === 'note' || value === 'action'
}

export function sourceOutputFromRow(row: SourceOutputRow): SourceOutput {
  if (!isOutputTargetType(row.targetType)) throw new Error(`未知的產出類型：${row.targetType}`)
  return { sourceId: row.sourceId, targetType: row.targetType, targetRef: row.targetRef, createdAt: row.createdAt }
}

export interface SourceOutputs {
  notes: string[]
  actions: string[]
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
}

/** 資料源 → 它產出的筆記路徑與行動 id。 */
export function outputsOfSource(sourceId: string, links: readonly SourceOutput[]): SourceOutputs {
  const own = links.filter(link => link.sourceId === sourceId)
  return {
    notes: unique(own.filter(link => link.targetType === 'note').map(link => link.targetRef)),
    actions: unique(own.filter(link => link.targetType === 'action').map(link => link.targetRef)),
  }
}

/** 筆記 → 來源資料源 id：frontmatter 的 sources 在前（保留作者排序），再補上連結表裡多出來的。 */
export function sourcesOfNote(notePath: string, frontmatterSources: readonly string[], links: readonly SourceOutput[]): string[] {
  return unique([
    ...frontmatterSources,
    ...links.filter(link => link.targetType === 'note' && link.targetRef === notePath).map(link => link.sourceId),
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
export function noteLinkDrift(notePath: string, frontmatterSources: readonly string[], links: readonly SourceOutput[]) {
  const linked = new Set(links.filter(link => link.targetType === 'note' && link.targetRef === notePath).map(link => link.sourceId))
  const declared = new Set(frontmatterSources)
  return {
    missingLinks: Array.from(declared).filter(id => !linked.has(id)),
    missingInFrontmatter: Array.from(linked).filter(id => !declared.has(id)),
  }
}
