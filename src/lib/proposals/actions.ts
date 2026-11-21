// Fork（almanac ALMNC-54.5）：「再次討論」與「回到來源對話」的動作。
// 再次討論＝附上說明，回到產生這則提案的那段對話（沒有就開一段標成「處理」的新對話），把說明當成 Scott 的一則訊息放進去，
// 等指揮官修改後重新提案（重新提案時新提案帶 previousProposalId，舊的就算被取代）。這裡不會自動叫 AI 回覆：
// 指揮官的分析流程是 ALMNC-54.6；Scott 也可以直接在對話裡接著談。
import useChatStore from '@/stores/chat'
import useDecideStore from '@/stores/decide'
import useProposalTrailStore from '@/stores/proposals'
import useThreadsStore from '@/stores/threads'
import { normalizeDiscussionNote } from './trail'

export interface DiscussTarget {
  /** 工作台項目 key（例如 collect:<itemId>:<proposalId>）。 */
  key: string
  conversationId?: number
}

/** 打開對話頁並切到那段對話（工作台頁會收起來）。 */
export async function openConversation(conversationId: number): Promise<void> {
  useDecideStore.getState().hide()
  useThreadsStore.getState().show()
  const chat = useChatStore.getState()
  if (chat.currentConversationId !== conversationId || chat.chats.length === 0) await chat.switchConversation(conversationId)
}

/** 找到來源對話；不在了（被刪掉）或本來就沒有時開一段新的，標成「處理」（有指揮官參與）。 */
async function ensureConversation(conversationId: number | undefined): Promise<number> {
  const chat = useChatStore.getState()
  if (conversationId !== undefined) {
    if (!chat.conversations.length) await chat.initConversations()
    if (useChatStore.getState().conversations.some(entry => entry.id === conversationId)) return conversationId
  }
  const id = await useChatStore.getState().createConversation()
  const created = useChatStore.getState().conversations.find(entry => entry.id === id) ?? { id, syncId: '' }
  await useThreadsStore.getState().setTag(created, 'process')
  return id
}

/**
 * 再次討論。說明是空的就什麼都不做並回傳 null；否則回傳回到的對話 id。
 * format 把（整理過的）說明變成放進對話的那則訊息，由畫面依語系組字。
 */
export async function discussProposal(target: DiscussTarget, note: string, format: (note: string) => string): Promise<number | null> {
  const text = normalizeDiscussionNote(note)
  if (!text) return null
  const conversationId = await ensureConversation(target.conversationId)
  useProposalTrailStore.getState().discuss(target.key, conversationId, text)
  await openConversation(conversationId)
  await useChatStore.getState().insert({ role: 'user', type: 'chat', content: format(text), inserted: false, conversationId })
  return conversationId
}
