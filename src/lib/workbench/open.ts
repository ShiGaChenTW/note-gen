// Fork（almanac ALMNC-54.8、54.16）：打開工作台、新增文件、新增資料源、新增對話的入口（側欄四個按鈕、N／T 快捷鍵、舊的收集／Inbox 入口都走這裡）。
import emitter from '@/lib/emitter'
import useDecideStore from '@/stores/decide'
import useWorkbenchStore, { type WorkbenchTab } from '@/stores/workbench'

export function openWorkbench(tab: WorkbenchTab = 'review', rowId?: string): void {
  const store = useWorkbenchStore.getState()
  store.setTab(tab)
  if (rowId) store.selectRow(rowId)
  useDecideStore.getState().show()
}

/** 新增資料源：記錄對話框的資料源模式（v14：新增資料源沿用記錄對話框）。 */
export function openAddSource(): void {
  emitter.emit('unified-record-open', { target: 'source' })
}

/** 新增對話：打開對話頁並開一段新對話。 */
export async function openNewConversation(): Promise<void> {
  const [{ default: useThreadsStore }, { default: useChatStore }] = await Promise.all([import('@/stores/threads'), import('@/stores/chat')])
  useThreadsStore.getState().show()
  await useChatStore.getState().startNewConversation()
}

/**
 * Fork（almanac ALMNC-54.16）：新增文件：建立「未命名.md」、打開編輯頁，游標在標題欄位。
 * Fork（almanac ALMNC-69.3，Q9）：入口改在新增資料源對話框；fromSource 時這篇的工具列顯示「完成」（按了才交給指揮官，存檔不送）。
 */
export async function openNewDocument(options: { fromSource?: boolean, journal?: boolean } = {}): Promise<void> {
  try {
    const { createNewDocument } = await import('@/lib/new-doc/create')
    const path = await createNewDocument()
    if (path && options.fromSource) {
      const { usePendingDoneStore } = await import('@/lib/new-doc/pending-done')
      usePendingDoneStore.getState().mark(path, { journal: options.journal === true })
      emitter.emit('show-editor')
    }
  } catch (error) {
    const { toast } = await import('@/hooks/use-toast')
    toast({ title: error instanceof Error ? error.message : String(error), variant: 'destructive' })
  }
}
