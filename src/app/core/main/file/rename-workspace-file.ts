// Fork（almanac ALMNC-54.16）：從 file-item.tsx 的改名流程抽出來，檔案樹改名和 V3 標題欄位共用同一條路，
// 開著的分頁、待存內容、圖片相對路徑、向量索引與連入連結（L7）都會跟著新路徑走。行為和原本 file-item 內嵌的版本一樣。
import { BaseDirectory, exists, rename } from '@tauri-apps/plugin-fs'
import {
  prepareActiveEditorDeactivationDurably,
  prepareActiveEditorPathMutationDurably,
} from '@/lib/editor-deactivation'
import { rewriteWorkspaceMarkdownMediaPaths } from '@/lib/markdown-media-path'
import { moveSelfHostedWorkspacePath } from '@/lib/self-hosted-sync/files'
import { withWorkspacePathMove } from '@/lib/sync/workspace-path-moves'
import useArticleStore from '@/stores/article'
import { requestLinkRewrite } from '../link-rewrite/link-rewrite-store'

/**
 * renamed：改好了；exists：目標已存在、沒有動；busy：同一個檔案正在改名或檔案樹找不到它；
 * cancelled：目前的編輯器有東西沒存好、不能切走。其他錯誤直接丟出（已還原成舊路徑）。
 */
export type RenameWorkspaceFileResult = 'renamed' | 'exists' | 'busy' | 'cancelled'

export async function renameWorkspaceFile(
  path: string,
  targetRelativePath: string,
  options: { onMoved?: () => void } = {},
): Promise<RenameWorkspaceFileResult> {
  const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
  const workspace = await getWorkspacePath()
  const activeFilePath = useArticleStore.getState().activeFilePath
  if (!await prepareActiveEditorDeactivationDurably(activeFilePath)) return 'cancelled'
  if (!await prepareActiveEditorPathMutationDurably(activeFilePath, [path])) return 'cancelled'

  const oldPathOptions = await getFilePathOptions(path)
  const newPathOptions = await getFilePathOptions(targetRelativePath)
  const targetExists = workspace.isCustom
    ? await exists(newPathOptions.path)
    : await exists(newPathOptions.path, { baseDir: newPathOptions.baseDir })
  if (targetExists) return 'exists'

  const renameOperationId = useArticleStore.getState().beginFileTreeRename(path, targetRelativePath)
  if (!renameOperationId) return 'busy'
  const { syncOpenTabsForPathChange } = useArticleStore.getState()
  try {
    await withWorkspacePathMove(path, targetRelativePath, async () => {
      if (await moveSelfHostedWorkspacePath(path, targetRelativePath)) {
        // Rust journal already completed the atomic move.
      } else if (workspace.isCustom) {
        await rename(oldPathOptions.path, newPathOptions.path)
      } else {
        await rename(oldPathOptions.path, newPathOptions.path, {
          newPathBaseDir: BaseDirectory.AppData,
          oldPathBaseDir: BaseDirectory.AppData,
        })
      }
      await syncOpenTabsForPathChange(path, targetRelativePath, false)
      try {
        await rewriteWorkspaceMarkdownMediaPaths([{
          sourcePath: path,
          targetPath: targetRelativePath,
        }])
      } catch (error) {
        if (await moveSelfHostedWorkspacePath(targetRelativePath, path)) {
          // Rust journal already completed the rollback.
        } else if (workspace.isCustom) {
          await rename(newPathOptions.path, oldPathOptions.path)
        } else {
          await rename(newPathOptions.path, oldPathOptions.path, {
            newPathBaseDir: BaseDirectory.AppData,
            oldPathBaseDir: BaseDirectory.AppData,
          })
        }
        await syncOpenTabsForPathChange(targetRelativePath, path, false)
        throw error
      }
      useArticleStore.getState().completeFileTreeRename(path, targetRelativePath, renameOperationId)
      options.onMoved?.()
    })
    const { renameVectorDocumentsByFilename } = await import('@/db/vector')
    await renameVectorDocumentsByFilename(path, targetRelativePath)
    // Fork L7：改名成功後詢問是否改寫連入的連結；內部自行 catch，不影響上面的改名結果
    await requestLinkRewrite([{ sourcePath: path, targetPath: targetRelativePath }])
  } finally {
    useArticleStore.getState().finishFileTreeRename(path, targetRelativePath, renameOperationId)
  }
  return 'renamed'
}
