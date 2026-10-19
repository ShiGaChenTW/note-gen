/**
 * Phase 2-2 L4：掃描全 vault 找目標筆記的未連結提及（I/O 由呼叫端注入 `readNote`）。
 * 展開面板時才掃描、依 `targetPath + revision` 快取（模組層最多 20 筆），不常駐記憶體。
 */

import { findUnlinkedMentions, type Mention } from '@/lib/markdown/unlinked-mentions'
import { noteKeyOf } from '@/lib/markdown/wikilink'
import type { IndexedNote } from './index-note'

export interface UnlinkedMentionGroup {
  sourcePath: string
  mentions: Mention[]
}

export interface ScanUnlinkedMentionsOptions {
  notes: Map<string, IndexedNote>
  revision: number
  readNote: (path: string) => Promise<string | null>
  signal?: AbortSignal
}

const CONCURRENCY = 8
const CACHE_LIMIT = 20
const cache = new Map<string, UnlinkedMentionGroup[]>()

function abortError(): Error {
  return typeof DOMException === 'function' ? new DOMException('掃描已中止', 'AbortError') : Object.assign(new Error('掃描已中止'), { name: 'AbortError' })
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** 測試用：清掉快取。 */
export function clearUnlinkedMentionsCache(): void {
  cache.clear()
}

/** 目標筆記用來比對的名稱：檔名加 frontmatter 別名。 */
export function mentionNamesFor(targetPath: string, notes: Map<string, IndexedNote>): string[] {
  const note = notes.get(targetPath)
  return [noteKeyOf(targetPath), ...(note?.aliases ?? [])]
}

/**
 * 候選＝索引裡所有 `.md`（排除目標本身），並行 8 個讀檔，跑純函式。
 * `signal` 中止時丟 AbortError，結果不進快取。
 */
export async function scanUnlinkedMentions(targetPath: string, options: ScanUnlinkedMentionsOptions): Promise<UnlinkedMentionGroup[]> {
  const key = `${options.revision}\u0000${targetPath}`
  const cached = cache.get(key)
  if (cached) return cached

  const names = mentionNamesFor(targetPath, options.notes)
  const targetLower = targetPath.toLowerCase()
  const candidates = [...options.notes.keys()].filter(path => /\.md$/i.test(path) && path.toLowerCase() !== targetLower)
  const groups: UnlinkedMentionGroup[] = []
  let cursor = 0

  const worker = async () => {
    while (cursor < candidates.length) {
      if (options.signal?.aborted) throw abortError()
      const sourcePath = candidates[cursor++]
      const content = await options.readNote(sourcePath)
      if (content === null) continue
      const mentions = findUnlinkedMentions(content, names)
      if (mentions.length > 0) groups.push({ sourcePath, mentions })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker))
  if (options.signal?.aborted) throw abortError()

  groups.sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0))
  cache.set(key, groups)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return groups
}
