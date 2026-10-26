/**
 * 「直接編輯後確認為新版本」(#56) 的純比較邏輯：判斷一篇提示詞筆記目前的內容，
 * 跟「最新一筆 prompt-version commit」比起來有沒有未確認的修改。
 *
 * 比較基準刻意不是 HEAD：自動快照可能已經把這次修改收進 HEAD 了，但那不代表
 * 使用者已經「確認」過這是新版本——所以永遠跟最新一筆 kind=prompt-version 的內容比。
 */

export interface PromptVersionBaseline {
  /** 這篇筆記是否已經有任何一筆 prompt-version commit。 */
  hasPromptVersion: boolean
  /** 最新一筆 prompt-version commit 當時的檔案內容；從沒有過 prompt-version 時為 null。 */
  content: string | null
}

/**
 * 從沒有任何提示詞版本的提示詞，只要有內容就算「未確認」，這樣才能確認出第一版。
 * 已經有版本的話，單純比對目前內容跟那一版的內容是否相同。
 */
export function hasUnconfirmedPromptVersionChange(
  currentContent: string,
  baseline: PromptVersionBaseline,
): boolean {
  if (!baseline.hasPromptVersion) {
    return currentContent.trim().length > 0
  }
  return currentContent !== baseline.content
}
