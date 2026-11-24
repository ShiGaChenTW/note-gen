/**
 * Fork（almanac ALMNC-76）：agent 改筆記時逐處接受或拒絕。
 *
 * 核准面板顯示的「處」與套用時寫入的內容共用同一份切段：buildLineDiff 的逐行差異，
 * 每個改動行前後各留 DIFF_CONTEXT_LINES 行前後文，前後文重疊的改動併成同一處。
 * 組出最終內容時，被接受的處寫入提議的行，被拒絕的處保留原文的行，沒改動的行照原文，
 * 換行符號（LF、CRLF、檔尾無換行）逐行保留。
 *
 * 這裡全是純函式：面板、runtime 與單元測試共用，不碰編輯器或檔案。
 */
import { buildLineDiff, type LineDiff } from './text-diff'

export const DIFF_CONTEXT_LINES = 3

/** 逐行差異的一段：hidden 是可收合的未改動內容，其餘每段就是面板上的一「處」。 */
export interface DiffSegment {
  from: number
  to: number
  hidden: boolean
}

export interface DiffHunk {
  /** 0 起算，等於面板上第 index + 1 處。 */
  index: number
  /** 在逐行差異陣列裡的範圍（含前後文）。 */
  from: number
  to: number
  /** 原文被刪除或取代的行（1 起算）；純新增時沒有。 */
  oldStart?: number
  oldEnd?: number
  /** 第一個改動前的原文行號（0 = 檔首）；純新增時代表插在這一行之後。 */
  after: number
  added: number
  removed: number
}

export function buildDiffSegments(lines: readonly LineDiff[], contextLines = DIFF_CONTEXT_LINES): DiffSegment[] {
  const visible = new Uint8Array(lines.length)
  lines.forEach((line, index) => {
    if (line.type === 'equal') return
    visible.fill(1, Math.max(0, index - contextLines), Math.min(lines.length, index + contextLines + 1))
  })
  const result: DiffSegment[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const hidden = visible[index] === 0
    const previous = result.at(-1)
    if (previous && previous.hidden === hidden) previous.to = index + 1
    else result.push({ from: index, to: index + 1, hidden })
  }
  return result
}

export function describeDiffHunks(lines: readonly LineDiff[], segments: readonly DiffSegment[]): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let lastOldLine = 0
  let cursor = 0
  for (const segment of segments) {
    for (; cursor < segment.from; cursor += 1) lastOldLine = lines[cursor].oldLine ?? lastOldLine
    if (segment.hidden) continue
    const hunk: DiffHunk = { index: hunks.length, from: segment.from, to: segment.to, after: lastOldLine, added: 0, removed: 0 }
    let changed = false
    for (; cursor < segment.to; cursor += 1) {
      const line = lines[cursor]
      if (line.type !== 'equal' && !changed) {
        changed = true
        hunk.after = lastOldLine
      }
      if (line.type === 'add') hunk.added += 1
      if (line.type === 'remove') {
        hunk.removed += 1
        hunk.oldStart ??= line.oldLine
        hunk.oldEnd = line.oldLine
      }
      lastOldLine = line.oldLine ?? lastOldLine
    }
    hunks.push(hunk)
  }
  return hunks
}

export function buildDiffHunks(before: string, after: string) {
  const lines = buildLineDiff(before, after)
  const segments = buildDiffSegments(lines)
  return { lines, segments, hunks: describeDiffHunks(lines, segments) }
}

function lineWithEnding(line: LineDiff) {
  return line.text + (line.lineEnding === 'crlf' ? '\r\n' : line.lineEnding === 'lf' ? '\n' : '')
}

/** 被接受的處取提議內容，被拒絕的處保留原文。 */
export function composeHunkContent(lines: readonly LineDiff[], hunks: readonly DiffHunk[], accepted: ReadonlySet<number>): string {
  const output: string[] = []
  let hunk = 0
  lines.forEach((line, index) => {
    if (line.type === 'equal') {
      output.push(lineWithEnding(line))
      return
    }
    while (hunk < hunks.length && hunks[hunk].to <= index) hunk += 1
    const take = accepted.has(hunks[hunk].index) ? line.type === 'add' : line.type === 'remove'
    if (take) output.push(lineWithEnding(line))
  })
  return output.join('')
}

export function composeAcceptedContent(before: string, after: string, accepted: Iterable<number>): string {
  const { lines, hunks } = buildDiffHunks(before, after)
  return composeHunkContent(lines, hunks, new Set(accepted))
}

export type HunkReviewOutcome =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'partial'; accepted: number[] }

/** 全部接受照原本整份套用；全部拒絕等於拒絕整份改動；其餘只寫入被接受的處。 */
export function resolveHunkReview(total: number, rejected: ReadonlySet<number>): HunkReviewOutcome {
  const accepted: number[] = []
  for (let index = 0; index < total; index += 1) if (!rejected.has(index)) accepted.push(index)
  if (accepted.length === total) return { kind: 'all' }
  if (accepted.length === 0) return { kind: 'none' }
  return { kind: 'partial', accepted }
}

interface ReviewablePreview {
  originalContent?: string
  modifiedContent?: string
  from?: number
  to?: number
}

/**
 * 只有整份內容的預覽能逐處套用。選取範圍的預覽（from/to）在視覺模式下，原文是純文字、
 * 提議是 Markdown，拼起來會讓被拒絕的處失去格式，所以只給整份接受或拒絕。
 */
export function supportsHunkReview(preview: ReviewablePreview): preview is ReviewablePreview & { originalContent: string; modifiedContent: string } {
  return preview.originalContent !== undefined && preview.modifiedContent !== undefined
    && preview.from === undefined && preview.to === undefined
}

export interface NarrowablePreview extends ReviewablePreview {
  previewParams: Record<string, unknown>
  originalContent: string
  modifiedContent: string
  operation?: 'create' | 'update' | 'delete'
}

export interface HunkReviewResult<T extends NarrowablePreview> {
  preview: T
  hunks: DiffHunk[]
  accepted: ReadonlySet<number>
}

/**
 * 把工具參數改成只含被接受的處，仍交給原本的工具執行（檔案走既有的協調寫入，
 * 編輯器走 replaceEditorContentTool），不另開寫入路徑。不支援的工具回傳 undefined。
 */
export function narrowEditPreviewToHunks<T extends NarrowablePreview>(
  toolName: string,
  preview: T,
  acceptedHunks: readonly number[],
): HunkReviewResult<T> | undefined {
  if (!supportsHunkReview(preview) || preview.operation === 'delete') return undefined
  const { lines, hunks } = buildDiffHunks(preview.originalContent, preview.modifiedContent)
  const accepted = new Set(acceptedHunks.filter(index => Number.isInteger(index) && index >= 0 && index < hunks.length))
  if (accepted.size === 0) return undefined
  const content = composeHunkContent(lines, hunks, accepted)
  const lastLine = preview.originalContent.split('\n').length
  let previewParams: Record<string, unknown>
  if (toolName === 'note_update_file') {
    previewParams = { ...preview.previewParams, content }
  } else if (toolName === 'editor_apply_transaction') {
    previewParams = { ...preview.previewParams,
      operations: [{ type: 'replace_lines', startLine: 1, endLine: lastLine, content, preserveListStructure: false }] }
  } else if (toolName === 'editor_replace_lines') {
    previewParams = { ...preview.previewParams, startLine: 1, endLine: lastLine, replaceContent: content, preserveListStructure: false }
  } else {
    return undefined
  }
  return { preview: { ...preview, previewParams, modifiedContent: content }, hunks, accepted }
}

function describeLocation(hunk: DiffHunk) {
  if (hunk.oldStart === undefined) {
    return hunk.after === 0 ? `在原文開頭新增 ${hunk.added} 行` : `在原文第 ${hunk.after} 行之後新增 ${hunk.added} 行`
  }
  const lines = hunk.oldStart === hunk.oldEnd ? `原文第 ${hunk.oldStart} 行` : `原文第 ${hunk.oldStart}–${hunk.oldEnd} 行`
  return hunk.added > 0 ? `${lines}，改為 ${hunk.added} 行` : `刪除${lines}`
}

export function hunkReviewData(hunks: readonly DiffHunk[], accepted: ReadonlySet<number>) {
  return {
    total: hunks.length,
    accepted: hunks.filter(hunk => accepted.has(hunk.index)).map(hunk => hunk.index + 1),
    rejected: hunks.filter(hunk => !accepted.has(hunk.index)).map(hunk => hunk.index + 1),
  }
}

/** 部分接受時附在工具結果裡給 agent：哪幾處寫入了、哪幾處維持原文。 */
export function describeHunkReview(hunks: readonly DiffHunk[], accepted: ReadonlySet<number>): string {
  const { total, accepted: acceptedNumbers, rejected } = hunkReviewData(hunks, accepted)
  return [
    `使用者逐處審核了這次改動：共 ${total} 處，接受 ${acceptedNumbers.length} 處（第 ${acceptedNumbers.join('、')} 處），`
      + `拒絕 ${rejected.length} 處（第 ${rejected.join('、')} 處）。只有被接受的處寫入了筆記，被拒絕的處維持原文；寫入後的完整內容見 changes。`,
    ...hunks.map(hunk => `- 第 ${hunk.index + 1} 處：${accepted.has(hunk.index) ? '已接受' : '已拒絕，維持原文'}（${describeLocation(hunk)}）`),
    '請依這個結果繼續：不要再次提出被拒絕的改動，除非使用者另外要求。',
  ].join('\n')
}

export type EditPreviewConflict =
  | 'FILE_CONTENT_CHANGED'
  | 'FILE_ALREADY_EXISTS'
  | 'EDITOR_VERSION_MISMATCH'
  | 'EDITOR_SELECTION_CHANGED'

export interface ConflictCheckPreview {
  kind: 'editor' | 'file'
  operation?: 'create' | 'update' | 'delete'
  baseContent?: string
  version?: number
  originalContent: string
  previewParams: Record<string, unknown>
  from?: number
  to?: number
}

/**
 * 套用前比對：agent 提出改動時讀到的內容（baseContent、編輯器版本、選取範圍）
 * 和現在的不同，就是使用者在提案之後又改過，回傳衝突代碼，不寫入。
 */
export function findEditPreviewConflict(
  preview: ConflictCheckPreview,
  current: { content: unknown; version?: unknown; selection?: Record<string, unknown> },
): EditPreviewConflict | undefined {
  if (preview.kind === 'file') {
    if (current.content !== preview.baseContent) return 'FILE_CONTENT_CHANGED'
    if (preview.operation === 'create' && current.content !== undefined) return 'FILE_ALREADY_EXISTS'
    return undefined
  }
  if (current.content !== preview.baseContent || current.version !== preview.version) return 'EDITOR_VERSION_MISMATCH'
  if (preview.from !== undefined && preview.to !== undefined) {
    const selection = current.selection ?? {}
    if (typeof preview.previewParams.position === 'number') {
      if (selection.to !== preview.from) return 'EDITOR_SELECTION_CHANGED'
    } else if (selection.from !== preview.from || selection.to !== preview.to || selection.text !== preview.originalContent) {
      return 'EDITOR_SELECTION_CHANGED'
    }
  }
  return undefined
}
