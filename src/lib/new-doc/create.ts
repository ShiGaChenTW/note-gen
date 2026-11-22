// Fork（almanac ALMNC-54.16）：側欄「新增文件」。建立「未命名.md」（被占用就照上游慣例加「 (1)」「 (2)」），
// 打開編輯頁，並請標題欄位拿到游標、全選「未命名」。
// 放在哪個資料夾沿用上游 newFile：目前開著的檔案在子資料夾就放同一個資料夾，否則放工作區根目錄。
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { generateUniqueFilename } from '@/lib/default-filename'
import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'
import { writeSelfHostedWorkspaceText } from '@/lib/self-hosted-sync/files'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import { UNTITLED_BASE, parentFolderOf } from './title'
import { useTitleFocusStore } from './title-focus'

/** 新文件放哪個資料夾：沿用上游 newFile，跟著目前開著的檔案；工作區外的絕對路徑一律放根目錄。 */
export function newDocumentFolder(activeFilePath: string): string {
  const parent = parentFolderOf(activeFilePath)
  if (!parent || parent.startsWith('/') || /^[a-zA-Z]:/.test(parent)) return ''
  return parent
}

/** 建立並打開一篇新文件，回傳它的相對路徑；目前的編輯器還有東西沒存好、不能切走時回傳 null。 */
export async function createNewDocument(): Promise<string | null> {
  const store = useArticleStore.getState()
  if (!await prepareActiveEditorDeactivationDurably(store.activeFilePath)) return null

  const folder = newDocumentFolder(store.activeFilePath)
  const fileName = await generateUniqueFilename(folder, UNTITLED_BASE)
  const path = folder ? `${folder}/${fileName}` : fileName

  if (!await writeSelfHostedWorkspaceText(path, '')) {
    const workspace = await getWorkspacePath()
    const options = await getFilePathOptions(path)
    if (workspace.isCustom) await writeTextFile(options.path, '')
    else await writeTextFile(options.path, '', { baseDir: options.baseDir })
  }

  // 檔案樹先插一列；資料夾還沒載入過就整棵重讀。之後標題改名要靠這一列找到檔案。
  if (!useArticleStore.getState().insertLocalEntry(path, false)) await useArticleStore.getState().loadFileTree()
  await useArticleStore.getState().ensurePathExpanded(path)

  useTitleFocusStore.getState().request(path)
  await useArticleStore.getState().setActiveFilePath(path, false, { deactivationAlreadyPrepared: true })
  return path
}
