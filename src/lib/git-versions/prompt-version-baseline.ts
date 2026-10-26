/**
 * 「直接編輯後確認為新版本」(#56)：找出一篇提示詞筆記目前的比較基準——
 * 最新一筆 prompt-version commit 當時的內容，不是 HEAD（見 ./prompt-version-diff.ts）。
 */
import { listGitVersionLog, showGitVersionFile } from './commands'
import type { PromptVersionBaseline } from './prompt-version-diff'

export async function getLatestPromptVersionBaseline(
  workspaceRoot: string,
  path: string,
): Promise<PromptVersionBaseline> {
  const log = await listGitVersionLog(workspaceRoot, { path })
  const latest = log.find(entry => entry.kind === 'prompt-version')
  if (!latest) return { hasPromptVersion: false, content: null }

  const content = await showGitVersionFile(workspaceRoot, latest.id, path)
  return { hasPromptVersion: true, content }
}
