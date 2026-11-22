// Fork（almanac ALMNC-54.5）：把再次討論送回來源對話，再由指揮官修訂並重新提案。
import useChatStore from '@/stores/chat'
import useCollectStore from '@/stores/collect'
import useSettingStore from '@/stores/setting'
import useDecideStore from '@/stores/decide'
import useProposalTrailStore from '@/stores/proposals'
import useThreadsStore from '@/stores/threads'
import { reviseProposal } from '@/lib/commander/revise'
import { normalizeDiscussionNote } from './trail'

const discussionsInFlight = new Set<string>()

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
  if (chat.currentConversationId !== conversationId || chat.isTemporaryConversation || chat.chats.length === 0) await chat.switchConversation(conversationId)
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
  await useThreadsStore.getState().loadProjects()
  await useThreadsStore.getState().setTag(created, 'process')
  await useChatStore.getState().switchConversation(id)
  return id
}

function findPendingProposal(key: string) {
  const { items } = useCollectStore.getState()
  if (items.some(item => item.proposals.some(proposal => proposal.previousProposalId === key))) return undefined
  for (const item of items) {
    const proposal = item.proposals.find(entry => `collect:${item.id}:${entry.id}` === key && entry.status === 'wait')
    if (proposal) return { item, proposal }
  }
}

/** 說明先寫進來源對話；有效修訂送進工作台之後才取代舊提案。 */
export async function discussProposal(
  target: DiscussTarget,
  note: string,
  format: (note: string) => string,
  formatReply: (title: string) => string = title => title,
): Promise<number | null> {
  const text = normalizeDiscussionNote(note)
  const { key } = target
  if (!text || discussionsInFlight.has(key)) return null

  discussionsInFlight.add(key)
  const trails = useProposalTrailStore.getState()
  const workspace = useSettingStore.getState().workspacePath
  let discussing = false
  try {
    await trails.hydrate()
    const trail = useProposalTrailStore.getState().trail[key]
    if (trail?.supersededBy) return null

    if (key.startsWith('collect:')) await useCollectStore.getState().hydrate()
    const original = findPendingProposal(key)
    if (!original && key.startsWith('collect:')) throw new Error('Pending proposal not found')
    const conversationId = await ensureConversation(trail?.conversationId ?? original?.proposal.conversationId ?? target.conversationId)
    await openConversation(conversationId)
    const history = useChatStore.getState().chats
      .filter(chat => chat.conversationId === conversationId && chat.type === 'chat' && chat.content?.trim())
      .slice(-12)
      .map(chat => ({ role: chat.role === 'user' ? 'user' : 'assistant', content: (chat.content ?? '').slice(0, 1200) }))
    const posted = await useChatStore.getState().insert({
      role: 'user', type: 'chat', content: format(text), inserted: false, conversationId,
    })
    if (!posted) throw new Error('Could not post proposal feedback')
    discussing = trails.discuss(key, conversationId, text)
    if (!original) return conversationId

    const { createDefaultCommanderDeps } = await import('@/lib/commander/default-deps')
    const deps = await createDefaultCommanderDeps()
    const { proposal, commanderName } = await reviseProposal({ key, conversationId, note: text, history, original: original.proposal }, deps)
    if (useSettingStore.getState().workspacePath !== workspace || findPendingProposal(key)?.proposal !== original.proposal) {
      throw new Error('Original proposal changed during discussion')
    }

    const id = `revision-${posted.id}`
    await deps.submitProposals({
      id, origin: deps.labels.origin({ agent: commanderName, source: original.proposal.title }), proposals: [proposal], conversationId,
    }, { durable: true, recordId: original.item.recordId })
    trails.supersede(key, `collect:${id}:${proposal.id}`)
    const reply = await useChatStore.getState().insert({
      role: 'system', type: 'chat', content: formatReply(proposal.title), inserted: false, conversationId,
    })
    if (!reply) throw new Error('Could not post proposal revision')
    useThreadsStore.getState().attachCard(reply.id, {
      type: 'proposal', id: `${id}:${proposal.id}`, kind: proposal.kind, title: proposal.title,
      due: proposal.due, time: proposal.time, status: 'wait', source: { itemId: id, proposalId: proposal.id },
    })
    return conversationId
  } catch (error) {
    if (discussing) trails.clearDiscussion(key)
    throw error
  } finally {
    discussionsInFlight.delete(key)
  }
}
