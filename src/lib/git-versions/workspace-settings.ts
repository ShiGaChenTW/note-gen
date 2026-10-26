/**
 * 版本管理是否啟用、自動快照開關，都是「每個工作區」各自的設定，存在 store.json，
 * 寫法照 src/lib/sync/workspace-repos.ts 的慣例：用正規化後的工作區路徑當 key。
 */
import { Store } from '@tauri-apps/plugin-store'

export interface GitVersionWorkspaceSettings {
  /** 使用者是否已經明確同意對這個工作區啟用版本管理（ADR 0003）。 */
  enabled: boolean
  /** 閒置或關閉 App 時是否自動快照；啟用版本管理後預設為 true。 */
  autoSnapshotEnabled: boolean
}

const DEFAULT_SETTINGS: GitVersionWorkspaceSettings = {
  enabled: false,
  autoSnapshotEnabled: true,
}

const GIT_VERSION_SETTINGS_KEY = 'gitVersionWorkspaceSettings'

/** auto-snapshot.ts 監聽這個事件來重新套用設定（切換工作區另外由 workspacePath 的 store 訂閱處理）。 */
export const GIT_VERSION_SETTINGS_CHANGED_EVENT = 'notegen-git-version-settings-changed'

type GitVersionWorkspaceSettingsMap = Record<string, GitVersionWorkspaceSettings>

function workspaceKey(workspaceRoot: string): string {
  return workspaceRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

export async function getGitVersionWorkspaceSettings(
  workspaceRoot: string,
): Promise<GitVersionWorkspaceSettings> {
  const store = await Store.load('store.json')
  const map = await store.get<GitVersionWorkspaceSettingsMap>(GIT_VERSION_SETTINGS_KEY) ?? {}
  const existing = map[workspaceKey(workspaceRoot)]
  return existing ? { ...DEFAULT_SETTINGS, ...existing } : DEFAULT_SETTINGS
}

export async function setGitVersionWorkspaceSettings(
  workspaceRoot: string,
  settings: Partial<GitVersionWorkspaceSettings>,
): Promise<GitVersionWorkspaceSettings> {
  const store = await Store.load('store.json')
  const map = await store.get<GitVersionWorkspaceSettingsMap>(GIT_VERSION_SETTINGS_KEY) ?? {}
  const key = workspaceKey(workspaceRoot)
  const next: GitVersionWorkspaceSettings = {
    ...DEFAULT_SETTINGS,
    ...map[key],
    ...settings,
  }
  await store.set(GIT_VERSION_SETTINGS_KEY, { ...map, [key]: next })
  await store.save()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(GIT_VERSION_SETTINGS_CHANGED_EVENT))
  }
  return next
}
