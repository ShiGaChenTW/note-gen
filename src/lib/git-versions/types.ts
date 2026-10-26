/**
 * 與 src-tauri/src/git_versions.rs 的回傳型別一一對應。
 * #54（歷史面板）、#55、#56 透過 ./commands.ts 取用這些型別，不要直接 invoke。
 */

/** 區分一筆 commit 是使用者確認的「提示詞版本」還是系統產生的「自動快照」（GLOSSARY.md）。 */
export type GitVersionKind = 'prompt-version' | 'auto-snapshot'

export interface GitVersionDetect {
  hasExistingRepo: boolean
}

export interface GitVersionEnableResult {
  reusedExisting: boolean
  createdGitignore: boolean
}

export interface GitVersionStatus {
  isRepo: boolean
  hasCommits: boolean
}

export interface GitVersionCommitInfo {
  id: string
  kind: GitVersionKind
}

export interface GitVersionLogEntry {
  id: string
  shortId: string
  summary: string
  /** 非本功能建立的 commit（例如既有 obsidian-git 歷史）解析不出來，為 null。 */
  kind: GitVersionKind | null
  authorName: string
  timeSeconds: number
}

export interface GitVersionDiff {
  oldContent: string | null
  newContent: string | null
}
