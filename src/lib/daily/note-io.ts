/**
 * 讀寫 vault 內筆記的共用 I/O（D1、D2、D6）：
 * 工作區可能是自訂路徑或預設的 AppData/article，自架同步啟用時改走它的原子寫入。
 */

import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { deleteSelfHostedWorkspacePath, writeSelfHostedWorkspaceText } from '@/lib/self-hosted-sync/files'
import { moveToAppTrash } from '@/lib/trash/runtime'
import useArticleStore from '@/stores/article'
import { noteAppWrite } from '@/lib/moc/app-writes'

/**
 * Fork（almanac ALMNC-85.4，設計 1.9）：App 自己寫的筆記（每日筆記、MOC、提案接受後的筆記…）跟編輯器存檔一樣丟進檔案推送佇列，
 * 不然要等使用者下次在編輯器存檔才會上傳。只動態載入：lib/daily 不在 import 時就拉進整條同步模組。
 */
function queueFilePush(relativePath: string): void {
  void import('@/lib/sync/sync-push-queue')
    .then(({ getSyncPushQueue }) => getSyncPushQueue().addTask(relativePath))
    .catch(error => console.debug('[sync] push queue unavailable:', error))
}

export async function noteExists(relativePath: string): Promise<boolean> {
  const options = await getFilePathOptions(relativePath)
  return options.baseDir
    ? exists(options.path, { baseDir: options.baseDir })
    : exists(options.path)
}

/** 檔案不存在時回傳 null。 */
export async function readNote(relativePath: string): Promise<string | null> {
  if (!relativePath || !await noteExists(relativePath)) return null
  const options = await getFilePathOptions(relativePath)
  return options.baseDir
    ? readTextFile(options.path, { baseDir: options.baseDir })
    : readTextFile(options.path)
}

/** 寫入筆記；上層資料夾不存在時一併建立。 */
export async function writeNote(relativePath: string, content: string, options?: { createNew?: boolean }): Promise<void> {
  // 新檔由檔案系統排他建立，避免同名舊檔被覆蓋。同步的工作區監看也會收到新檔事件。
  if (!options?.createNew && await writeSelfHostedWorkspaceText(relativePath, content)) {
    noteAppWrite(relativePath, undefined, content)
    queueFilePush(relativePath)
    return
  }

  const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
  const workspace = await getWorkspacePath()
  if (parent && !await noteExists(parent)) {
    const dir = await getFilePathOptions(parent)
    if (workspace.isCustom) await mkdir(dir.path, { recursive: true })
    else await mkdir(dir.path, { baseDir: dir.baseDir, recursive: true })
  }
  const file = await getFilePathOptions(relativePath)
  const createNew = options?.createNew
  if (workspace.isCustom) await writeTextFile(file.path, content, createNew ? { createNew } : undefined)
  else await writeTextFile(file.path, content, { baseDir: file.baseDir, createNew })
  // Fork（almanac ALMNC-69.10）：App 自己寫的 MOC 不算 Obsidian 手動編輯。
  noteAppWrite(relativePath, createNew ? null : undefined, content)
  queueFilePush(relativePath)
}

/** 刪除這次操作新建而需要還原的筆記（移入最近刪除）。 */
export async function removeNote(relativePath: string): Promise<void> {
  if (await deleteSelfHostedWorkspacePath(relativePath, 'file', {
    deletedBy: 'scott',
    actorRole: 'scott',
    source: 'other',
  })) return
  await moveToAppTrash(relativePath, {
    deletedBy: 'scott',
    actorRole: 'scott',
    source: 'other',
  })
}

/** 讓新建的檔案出現在檔案樹並展開到它。 */
export async function revealInFileTree(relativePath: string): Promise<void> {
  const article = useArticleStore.getState()
  if (!article.reconcileLocalFile(relativePath, true)) {
    const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
    if (parent) await article.loadCollapsibleFiles(parent, { force: true, skipRemoteSync: true })
    else await article.loadFileTree({ skipRemoteSync: true })
    useArticleStore.getState().reconcileLocalFile(relativePath, true)
  }
  await useArticleStore.getState().ensurePathExpanded(relativePath)
}
