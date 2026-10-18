/**
 * 讀寫 vault 內筆記的共用 I/O（D1、D2、D6）：
 * 工作區可能是自訂路徑或預設的 AppData/article，自架同步啟用時改走它的原子寫入。
 */

import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { writeSelfHostedWorkspaceText } from '@/lib/self-hosted-sync/files'
import useArticleStore from '@/stores/article'

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
export async function writeNote(relativePath: string, content: string): Promise<void> {
  if (await writeSelfHostedWorkspaceText(relativePath, content)) return

  const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
  const workspace = await getWorkspacePath()
  if (parent && !await noteExists(parent)) {
    const dir = await getFilePathOptions(parent)
    if (workspace.isCustom) await mkdir(dir.path, { recursive: true })
    else await mkdir(dir.path, { baseDir: dir.baseDir, recursive: true })
  }
  const file = await getFilePathOptions(relativePath)
  if (workspace.isCustom) await writeTextFile(file.path, content)
  else await writeTextFile(file.path, content, { baseDir: file.baseDir })
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
