// Fork（almanac ALMNC-14）：對話頁的狀態。做法同收集頁、Inbox 頁：同一時間只開一個全頁覆蓋層。
// 對話本身（列表、目前對話、訊息）仍在 useChatStore，這裡只管頁面開關、專案分組、搜尋，與訊息內嵌卡片。
import { create } from 'zustand'
import { applyCardAction, type CardAction, type ThreadCard } from '@/lib/threads/cards'
import {
  assignProject, dropProject, loadProjectMap, renameProject, saveProjectMap, type ThreadGroupMode, type ThreadProjectMap,
} from '@/lib/threads/projects'
import {
  assignTag, claimDraftTag, loadTagMap, saveTagMap, tagAfterCommanderJoins, tagOf, type ThreadTag, type ThreadTagMap,
} from '@/lib/threads/tags'
import { threadKey as keyOf } from '@/lib/threads/projects'
import type { Conversation } from '@/db/conversations'
import useCollectStore from './collect'
import useHomeStore from './home'
import useInboxStore from './inbox'
import usePromptLibraryStore from './prompt-library'

interface ThreadsState {
  visible: boolean
  show: () => void
  hide: () => void

  projectMap: ThreadProjectMap
  projectsLoaded: boolean
  loadProjects: () => Promise<void>
  moveToProject: (threadKey: string, project: string) => Promise<void>
  renameProject: (from: string, to: string) => Promise<void>
  removeProject: (project: string) => Promise<void>

  /** Fork（almanac ALMNC-54.4）：對話 key → 查詢／處理／日程。沒有的就是預設「處理」（lib/threads/tags.ts）。 */
  tagMap: ThreadTagMap
  setTag: (conversation: ConversationRef, tag: ThreadTag) => Promise<void>
  /** 把內容交給指揮官或邀請指揮官：查詢、日程改成處理，同一段對話延續。 */
  commanderJoins: (conversation: ConversationRef) => Promise<void>
  /** 新對話還沒建立（第一則訊息前）時選的標籤，對話建立後由 claimDraftTag 補進對照表。 */
  draftTag: { tag: ThreadTag, at: number } | null
  setDraftTag: (tag: ThreadTag | null) => void
  claimDraftTag: (conversations: Pick<Conversation, 'id' | 'syncId' | 'createdAt'>[], currentId: number | null) => Promise<void>
  /** Scott 對「要不要轉給指揮官？」回答「不用」的訊息 id；只放記憶體。 */
  transferDismissed: number[]
  dismissTransfer: (chatId: number) => void

  mode: ThreadGroupMode
  setMode: (mode: ThreadGroupMode) => void
  query: string
  setQuery: (query: string) => void

  /** 對話頁放對話面板的位置；有值時，右側欄的對話面板會搬過來（chat-dock.tsx）。 */
  chatHost: HTMLElement | null
  setChatHost: (host: HTMLElement | null) => void

  /** chatId → 掛在那則訊息下面的卡片。只放記憶體：提案本身（收集頁）也還沒持久化。 */
  cards: Record<number, ThreadCard[]>
  attachCard: (chatId: number, card: ThreadCard) => void
  actOnCard: (chatId: number, cardId: string, action: CardAction) => Promise<void>
}

type ConversationRef = Pick<Conversation, 'id' | 'syncId'>

const useThreadsStore = create<ThreadsState>((set, get) => {
  async function persist(next: ThreadProjectMap) {
    set({ projectMap: next })
    await saveProjectMap(next)
  }
  async function persistTags(next: ThreadTagMap) {
    if (next === get().tagMap) return
    set({ tagMap: next })
    await saveTagMap(next)
  }
  return {
    visible: false,
    show: () => {
      useHomeStore.getState().hide()
      useInboxStore.getState().hide()
      usePromptLibraryStore.getState().hide()
      useCollectStore.getState().hide()
      set({ visible: true })
    },
    hide: () => set({ visible: false }),

    projectMap: {},
    projectsLoaded: false,
    loadProjects: async () => {
      if (get().projectsLoaded) return
      const [map, tags] = await Promise.all([loadProjectMap(), loadTagMap()])
      // 載入期間使用者可能已經移動過對話：以已有的為準
      set(state => ({ projectMap: { ...map, ...state.projectMap }, tagMap: { ...tags, ...state.tagMap }, projectsLoaded: true }))
    },
    moveToProject: async (key, project) => persist(assignProject(get().projectMap, key, project)),
    renameProject: async (from, to) => persist(renameProject(get().projectMap, from, to)),
    removeProject: async project => persist(dropProject(get().projectMap, project)),

    tagMap: {},
    setTag: async (conversation, tag) => persistTags(assignTag(get().tagMap, keyOf(conversation), tag)),
    commanderJoins: async (conversation) => {
      const next = tagAfterCommanderJoins(tagOf(get().tagMap, conversation))
      if (next) await persistTags(assignTag(get().tagMap, keyOf(conversation), next))
    },
    draftTag: null,
    setDraftTag: tag => set({ draftTag: tag ? { tag, at: Date.now() } : null }),
    claimDraftTag: async (conversations, currentId) => {
      const claim = claimDraftTag(conversations, currentId, get().draftTag, get().tagMap)
      if (!claim) return
      set({ draftTag: null })
      await persistTags(assignTag(get().tagMap, claim.key, claim.tag))
    },
    transferDismissed: [],
    dismissTransfer: chatId => set(state => ({ transferDismissed: [...state.transferDismissed, chatId] })),

    mode: 'project',
    setMode: mode => set({ mode }),
    query: '',
    setQuery: query => set({ query }),

    chatHost: null,
    setChatHost: chatHost => set({ chatHost }),

    cards: {},
    attachCard: (chatId, card) => set(state => ({
      cards: { ...state.cards, [chatId]: [...(state.cards[chatId] ?? []).filter(entry => entry.id !== card.id), card] },
    })),
    actOnCard: async (chatId, cardId, action) => {
      const card = get().cards[chatId]?.find(entry => entry.id === cardId)
      if (!card) return
      // 提案卡連著收集頁的提案時，接受／放棄走收集頁的流程（會寫筆記檔或今日日誌）。
      // 再次討論由畫面先呼叫 lib/proposals/actions 的 discussProposal（記說明、回到對話），這裡只改卡片狀態。
      if (card.type === 'proposal' && card.source) {
        const collect = useCollectStore.getState()
        if (action === 'accept') await collect.accept(card.source.itemId, card.source.proposalId)
        if (action === 'reject') collect.reject(card.source.itemId, card.source.proposalId)
      }
      const next = applyCardAction(card, action)
      if (next === card) return
      set(state => ({ cards: { ...state.cards, [chatId]: (state.cards[chatId] ?? []).map(entry => entry.id === cardId ? next : entry) } }))
    },
  }
})

export default useThreadsStore
