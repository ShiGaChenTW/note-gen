/**
 * 自動快照（GLOSSARY.md）：閒置一段時間自動為所有已追蹤的變更留一筆版本；
 * 關閉 App 時的最後一次快照改由 Rust 端處理（見 src-tauri/src/git_versions.rs 的
 * flush_pending_snapshot_on_exit），因為那時已經叫不到前端，所以每次情境改變都要同步告知
 * Rust 端目前的工作區路徑與是否開啟（見 configureAutoSnapshot）。
 *
 * initGitVersionAutoSnapshotRuntime() 在 app layout 掛載一次即可：之後切換工作區
 * （useSettingStore 的 workspacePath）或版本管理設定改變（GIT_VERSION_SETTINGS_CHANGED_EVENT）
 * 都會自動重新套用。
 */
import emitter from '@/lib/emitter'
import useSettingStore from '@/stores/setting'
import { getWorkspaceAbsolutePath } from '@/lib/workspace'
import { AUTO_SNAPSHOT_COMMIT_SUMMARY, commitGitVersion, setGitVersionAutoSnapshotContext } from './commands'
import { getGitVersionWorkspaceSettings, GIT_VERSION_SETTINGS_CHANGED_EVENT } from './workspace-settings'

/** 閒置多久後觸發自動快照；寫筆記期間持續重置，不會在編輯中頻繁觸發。 */
export const AUTO_SNAPSHOT_IDLE_MS = 5 * 60 * 1000

interface AutoSnapshotRuntimeContext {
  workspaceRoot: string
}

let runtimeContext: AutoSnapshotRuntimeContext | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let pendingCommit: Promise<void> | null = null

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function scheduleIdleSnapshot(): void {
  clearIdleTimer()
  if (!runtimeContext) return
  idleTimer = setTimeout(() => {
    void flushAutoSnapshot()
  }, AUTO_SNAPSHOT_IDLE_MS)
}

function handleActivity(): void {
  scheduleIdleSnapshot()
}

/** 立即嘗試自動快照一次；沒有變更時 commitGitVersion 本身就是沒事發生的 no-op。 */
export async function flushAutoSnapshot(): Promise<void> {
  if (!runtimeContext || pendingCommit) return
  const { workspaceRoot } = runtimeContext
  pendingCommit = (async () => {
    try {
      await commitGitVersion(workspaceRoot, AUTO_SNAPSHOT_COMMIT_SUMMARY, 'auto-snapshot')
    } catch (error) {
      console.error('自動快照失敗:', error)
    }
  })().finally(() => {
    pendingCommit = null
  })
  await pendingCommit
}

/**
 * 設定目前的自動快照情境。`workspaceRoot` 為 null、或版本管理／自動快照未啟用時，關閉閒置計時器，
 * 並同步告知 Rust 端（關閉 App 時用）。
 */
export async function configureAutoSnapshot(context: {
  workspaceRoot: string | null
  enabled: boolean
  autoSnapshotEnabled: boolean
}): Promise<void> {
  const active = context.enabled && context.autoSnapshotEnabled && context.workspaceRoot !== null

  clearIdleTimer()
  runtimeContext = active ? { workspaceRoot: context.workspaceRoot as string } : null
  if (active) scheduleIdleSnapshot()

  await setGitVersionAutoSnapshotContext({
    workspaceRoot: active ? context.workspaceRoot : null,
    autoSnapshotEnabled: active,
    snapshotSummary: AUTO_SNAPSHOT_COMMIT_SUMMARY,
  })
}

/** 從已儲存的每工作區設定讀出啟用狀態，套用到執行中的自動快照情境。 */
export async function hydrateAutoSnapshotForWorkspace(workspaceRoot: string): Promise<void> {
  const settings = await getGitVersionWorkspaceSettings(workspaceRoot)
  await configureAutoSnapshot({
    workspaceRoot,
    enabled: settings.enabled,
    autoSnapshotEnabled: settings.autoSnapshotEnabled,
  })
}

async function rehydrateCurrentWorkspace(): Promise<void> {
  try {
    const root = await getWorkspaceAbsolutePath()
    await hydrateAutoSnapshotForWorkspace(root)
  } catch (error) {
    console.error('套用版本管理自動快照設定失敗:', error)
  }
}

/**
 * 整個 App 生命週期只要在 layout 掛載一次：
 * - 監聽筆記存檔活動來重置閒置計時器
 * - 工作區切換、版本管理設定改變時重新讀取設定並套用
 * 回傳的函式用於卸載時清理。
 */
export function initGitVersionAutoSnapshotRuntime(): () => void {
  emitter.on('article-saved', handleActivity)
  window.addEventListener(GIT_VERSION_SETTINGS_CHANGED_EVENT, rehydrateCurrentWorkspace)

  let lastWorkspacePath = useSettingStore.getState().workspacePath
  const unsubscribeStore = useSettingStore.subscribe((state) => {
    if (state.workspacePath === lastWorkspacePath) return
    lastWorkspacePath = state.workspacePath
    void rehydrateCurrentWorkspace()
  })

  void rehydrateCurrentWorkspace()

  return () => {
    emitter.off('article-saved', handleActivity)
    window.removeEventListener(GIT_VERSION_SETTINGS_CHANGED_EVENT, rehydrateCurrentWorkspace)
    unsubscribeStore()
    clearIdleTimer()
    runtimeContext = null
  }
}

/** 僅供測試使用：重置模組內部狀態，避免測試之間互相汙染。 */
export function resetAutoSnapshotStateForTests(): void {
  clearIdleTimer()
  runtimeContext = null
  pendingCommit = null
}
