/**
 * 提示詞判定（#53）：純函式，依 F3 vault 索引判斷哪些筆記是「提示詞」。
 * 提示詞＝放在提示詞資料夾（設定可改，預設 `Prompts`）且 frontmatter `type: prompt`。
 * 搬出資料夾就不算提示詞；資料夾外仍標 `type: prompt` 的筆記算「未納入」，供庫頁提示。
 */

import type { IndexedNote } from '@/lib/vault-index/index-note'

export const DEFAULT_PROMPT_FOLDER = 'Prompts'

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, '')
}

export function isInPromptFolder(path: string, promptFolder: string): boolean {
  const folder = normalizeFolder(promptFolder)
  if (!folder) return true
  return path === folder || path.startsWith(`${folder}/`)
}

function frontmatterType(frontmatter: Record<string, unknown> | null): string | null {
  const type = frontmatter?.type
  return typeof type === 'string' ? type : null
}

/** frontmatter 標了 `type: prompt`，不論在不在提示詞資料夾裡。 */
export function hasPromptType(note: Pick<IndexedNote, 'frontmatter'>): boolean {
  return frontmatterType(note.frontmatter) === 'prompt'
}

/** 真正算「提示詞」：在資料夾裡 *且* 標了 type: prompt。 */
export function isPromptNote(note: Pick<IndexedNote, 'path' | 'frontmatter'>, promptFolder: string): boolean {
  return hasPromptType(note) && isInPromptFolder(note.path, promptFolder)
}

/** 標了 type: prompt，但人不在資料夾裡——庫頁「N 篇未納入」要算的那些。 */
export function isUnlistedPromptNote(note: Pick<IndexedNote, 'path' | 'frontmatter'>, promptFolder: string): boolean {
  return hasPromptType(note) && !isInPromptFolder(note.path, promptFolder)
}

export function collectPromptNotes(notes: Iterable<IndexedNote>, promptFolder: string): IndexedNote[] {
  const out: IndexedNote[] = []
  for (const note of notes) if (isPromptNote(note, promptFolder)) out.push(note)
  return out
}

export function collectUnlistedPromptNotes(notes: Iterable<IndexedNote>, promptFolder: string): IndexedNote[] {
  const out: IndexedNote[] = []
  for (const note of notes) if (isUnlistedPromptNote(note, promptFolder)) out.push(note)
  return out
}

/** 筆記檔名（不含路徑與 .md），供清單標題用的保底值。 */
export function promptFileTitle(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

/** 列表用標題：frontmatter.title 優先，其次是檔名。 */
export function promptTitle(note: Pick<IndexedNote, 'path' | 'frontmatter'>): string {
  const title = note.frontmatter?.title
  return typeof title === 'string' && title.trim() ? title.trim() : promptFileTitle(note.path)
}

/** 「新增提示詞」的預設內容：放進提示詞資料夾時要帶的 frontmatter 與起手骨架。 */
export function newPromptContent(title: string): string {
  return [
    '---',
    'type: prompt',
    'tags: []',
    'variables: []',
    '---',
    '',
    `# ${title}`,
    '',
    '',
    '## 變數',
    '',
  ].join('\n')
}

export type PromptSort = 'mostUsed' | 'recentlyUsed' | 'title'

export interface PromptUsageLookup {
  useCount: number
  lastUsedAt: number
}

/** 依排序模式排一份提示詞清單的複本；用量查不到時當作 0 次、從未使用。 */
export function sortPromptNotes(
  notes: readonly IndexedNote[],
  usage: ReadonlyMap<string, PromptUsageLookup>,
  sort: PromptSort,
): IndexedNote[] {
  const withUsage = (path: string) => usage.get(path) ?? { useCount: 0, lastUsedAt: 0 }
  return [...notes].sort((a, b) => {
    if (sort === 'mostUsed') {
      const diff = withUsage(b.path).useCount - withUsage(a.path).useCount
      if (diff !== 0) return diff
      return promptTitle(a).localeCompare(promptTitle(b))
    }
    if (sort === 'recentlyUsed') {
      const diff = withUsage(b.path).lastUsedAt - withUsage(a.path).lastUsedAt
      if (diff !== 0) return diff
      return promptTitle(a).localeCompare(promptTitle(b))
    }
    return promptTitle(a).localeCompare(promptTitle(b))
  })
}
