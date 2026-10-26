/**
 * 本機 git 版本管理（Issue #52）的前端 API：包著 src-tauri/src/git_versions.rs 的 Tauri command。
 * 只在桌面版使用；所有函式都需要工作區的「絕對路徑」（見 getWorkspaceAbsolutePath()）。
 *
 * #54（歷史面板）、#55、#56 應該透過這裡取用，不要直接 invoke('git_version_...')。
 */
import { invoke } from '@tauri-apps/api/core'
import type {
  GitVersionCommitInfo,
  GitVersionDetect,
  GitVersionDiff,
  GitVersionEnableResult,
  GitVersionKind,
  GitVersionLogEntry,
  GitVersionStatus,
} from './types'

/** 偵測工作區是否已經有本機 git repo，給啟用前的同意對話框判斷文案用。 */
export async function detectGitVersionRepo(workspaceRoot: string): Promise<GitVersionDetect> {
  return await invoke<GitVersionDetect>('git_version_detect', { workspaceRoot })
}

/**
 * 啟用版本管理：沒有 .git 就建立並寫入預設 .gitignore；已經有 .git（例如 obsidian-git）就直接沿用，
 * 不會重建、不會改動它既有的設定。呼叫前必須先讓使用者看過 detectGitVersionRepo() 的結果並明確同意。
 */
export async function enableGitVersionControl(workspaceRoot: string): Promise<GitVersionEnableResult> {
  return await invoke<GitVersionEnableResult>('git_version_enable', { workspaceRoot })
}

export async function getGitVersionStatus(workspaceRoot: string): Promise<GitVersionStatus> {
  return await invoke<GitVersionStatus>('git_version_status', { workspaceRoot })
}

/**
 * 以 `message` 建立一筆 commit，`kind` 決定 trailer 區分成提示詞版本或自動快照。
 * 不傳 `paths` 代表「所有已追蹤的變更」（自動快照用）；傳 `paths` 只會 stage 那些相對路徑（提示詞版本用）。
 * 沒有任何變更時回傳 null，不會產生空 commit——除非傳 `allowEmpty: true`：
 * 自動快照可能已經把這次修改收進 HEAD，這時「確認為新版本」(#56) 仍要留下一筆標記用的
 * prompt-version commit，即使樹內容和上一筆相同。
 */
export async function commitGitVersion(
  workspaceRoot: string,
  summary: string,
  kind: GitVersionKind,
  paths?: string[],
  allowEmpty = false,
): Promise<GitVersionCommitInfo | null> {
  return await invoke<GitVersionCommitInfo | null>('git_version_commit', {
    workspaceRoot,
    summary,
    kind,
    paths: paths ?? null,
    allowEmpty,
  })
}

/**
 * 列出 commit 歷史，由新到舊。傳 `path` 只回傳改到那個相對路徑的 commit（某篇筆記的歷史）。
 */
export async function listGitVersionLog(
  workspaceRoot: string,
  options?: { path?: string; limit?: number },
): Promise<GitVersionLogEntry[]> {
  return await invoke<GitVersionLogEntry[]>('git_version_log', {
    workspaceRoot,
    path: options?.path ?? null,
    limit: options?.limit ?? null,
  })
}

/** 讀取某個 commit 當時某個相對路徑的檔案內容；該版本沒有這個檔案時回傳 null。 */
export async function showGitVersionFile(
  workspaceRoot: string,
  commitId: string,
  path: string,
): Promise<string | null> {
  return await invoke<string | null>('git_version_show', { workspaceRoot, commitId, path })
}

/** 取得某個 commit 相對於它上一筆 commit，某個相對路徑檔案的新舊內容（供前端自行渲染 diff）。 */
export async function diffGitVersionFile(
  workspaceRoot: string,
  commitId: string,
  path: string,
): Promise<GitVersionDiff> {
  return await invoke<GitVersionDiff>('git_version_diff', { workspaceRoot, commitId, path })
}

/**
 * 告知 Rust 端目前的自動快照情境（啟用中的工作區路徑、是否開啟自動快照、快照摘要文案），
 * 讓關閉 App 時（RunEvent::Exit，此時已經叫不到前端）能補最後一次快照。
 * 在啟用/停用版本管理、切換工作區、切換自動快照開關時都要呼叫一次（見 ./auto-snapshot.ts）。
 */
export async function setGitVersionAutoSnapshotContext(context: {
  workspaceRoot: string | null
  autoSnapshotEnabled: boolean
  snapshotSummary: string
}): Promise<void> {
  await invoke('git_version_set_auto_snapshot_context', {
    workspaceRoot: context.workspaceRoot,
    autoSnapshotEnabled: context.autoSnapshotEnabled,
    snapshotSummary: context.snapshotSummary,
  })
}

/**
 * 自動快照 commit 固定用這個摘要（GLOSSARY.md 的用詞），不跟著介面語言變動，
 * 這樣使用者換了介面語言之後，`git log` 仍能用同一個字串找到所有自動快照。
 */
export const AUTO_SNAPSHOT_COMMIT_SUMMARY = '自動快照'
