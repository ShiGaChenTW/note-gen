// Fork（almanac ALMNC-45）：釘選資料跟著檔案走。筆記改名或移動後更新路徑，刪除後從清單移除。
// 監聽 App 內的改名／移動／刪除事件（檔案樹、分頁、AI 工具、外掛都會發），以及檔案監看到的外部變更。
// 不論新舊介面都要跟著走（classic 只是看不到入口，已釘的資料不能壞掉）。
import emitter from '@/lib/emitter'
import useEinkStore from '@/stores/eink'

type ExistsCheck = (workspaceRoot: string, path: string) => Promise<boolean>

async function defaultExists(workspaceRoot: string, path: string): Promise<boolean> {
  const [{ exists }, { join }] = await Promise.all([import('@tauri-apps/plugin-fs'), import('@tauri-apps/api/path')])
  return exists(await join(workspaceRoot, path))
}

/** 啟動監聽；回傳取消函式。exists 可注入（測試用）。 */
export function initEinkPinSync(fileExists: ExistsCheck = defaultExists): () => void {
  const store = () => useEinkStore.getState()
  const report = (error: unknown) => console.warn('[eink] pin sync failed:', error instanceof Error ? error.message : error)

  const onMove = ({ oldPath, newPath }: { oldPath: string, newPath: string }) => {
    void store().handlePathMove(oldPath, newPath).catch(report)
  }
  const onDelete = ({ path, isFolder }: { path: string, isFolder: boolean }) => {
    void store().handlePathDelete(path, isFolder).catch(report)
  }
  const onWorkspaceFile = ({ kind, path, previousPath, workspaceRoot }: {
    kind: string, path: string, previousPath?: string, workspaceRoot: string
  }) => {
    if (kind === 'moved' && previousPath) {
      onMove({ oldPath: previousPath, newPath: path })
      return
    }
    if (kind !== 'deleted') return
    const pinned = store().pins.some(pin => pin.path === path || pin.path.startsWith(`${path}/`))
    if (!pinned) return
    // 外部編輯器存檔時常是「刪掉再寫回」：確認檔案真的不在了才移除
    void fileExists(workspaceRoot, path)
      .then(stillThere => stillThere ? undefined : store().handlePathDelete(path, true))
      .catch(report)
  }

  emitter.on('editor-navigation-path-moved', onMove)
  emitter.on('editor-file-path-changed', onMove)
  emitter.on('editor-navigation-path-deleted', onDelete)
  emitter.on('workspace-file-changed', onWorkspaceFile)
  return () => {
    emitter.off('editor-navigation-path-moved', onMove)
    emitter.off('editor-file-path-changed', onMove)
    emitter.off('editor-navigation-path-deleted', onDelete)
    emitter.off('workspace-file-changed', onWorkspaceFile)
  }
}
