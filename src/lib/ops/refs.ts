// Fork（almanac ALMNC-69.9）：從檔案取操作要用的編號與名稱（純函式）。
import { parseV3Note } from '@/lib/v3-model/note'
import type { RecordInput } from './service'

/** 筆記 frontmatter 的 N／M 編號；沒有或讀不懂是 undefined。 */
export function idOfContent(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  try {
    return parseV3Note(raw).fields.id
  } catch {
    return undefined
  }
}

export function titleOfPath(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

/**
 * 已寫好的檔案前後內容 → 操作：之前不存在＝新增筆記、之後不存在＝移除、其他＝內容修改。內容沒變的略過。
 * 用在沒有更細資訊的寫入（清理提案的筆記變更、檔案變更提案、任務寫進日誌）。
 */
export function snapshotInputs(changes: ReadonlyArray<{ path: string, before: string | null, after: string | null }>): RecordInput[] {
  return changes.flatMap(({ path, before, after }): RecordInput[] => {
    if (before === after) return []
    const noteId = idOfContent(after ?? before)
    const ref = { ...(noteId ? { noteId } : {}), path, title: titleOfPath(path) }
    if (before === null) return [{ spec: { kind: 'note.create', ...ref, content: after! } }]
    if (after === null) return [{ spec: { kind: 'note.delete', ...ref, content: before } }]
    return [{ spec: { kind: 'note.edit', ...ref, before, after } }]
  })
}
