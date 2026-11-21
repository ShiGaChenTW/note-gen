// Fork（almanac ALMNC-54.8）：打開工作台、新增資料源、新增對話的入口（側欄三個按鈕、N／T 快捷鍵、舊的收集／Inbox 入口都走這裡）。
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
