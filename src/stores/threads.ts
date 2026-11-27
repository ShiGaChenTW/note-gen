// Fork（almanac ALMNC-14）：對話頁的狀態。做法同收集頁、Inbox 頁：同一時間只開一個全頁覆蓋層。
// 對話本身（列表、目前對話、訊息）仍在 useChatStore，這裡只管頁面開關、專案分組、搜尋，與訊息內嵌卡片。
import { create } from 'zustand'
import { applyCardAction, threadProposalKey, type CardAction, type DirectEditCardData, type ThreadCard } from '@/lib/threads/cards'
import {
  assignProject, dropProject, loadProjectMap, renameProject, saveProjectMap, type ThreadGroupMode, type ThreadProjectMap,
} from '@/lib/threads/projects'
import {
  assignTag, claimDraftTag, loadTagMap, saveTagMap, tagAfterCommanderJoins, tagOf, type ThreadTag, type ThreadTagMap,
} from '@/lib/threads/tags'
import { threadKey as keyOf } from '@/lib/threads/projects'
import { archiveProject, findArchivedProject, restoreProject, type ArchivedProjectMap } from '@/lib/projects/archive'
import { createProjectArchiveDeps, loadArchivedProjects, saveArchivedProjects } from '@/lib/projects/archive-io'
import type { Conversation } from '@/db/conversations'
import useCollectStore from './collect'
import useHomeStore from './home'
import useInboxStore from './inbox'
import usePromptLibraryStore from './prompt-library'
import useProposalTrailStore from './proposals'

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

  /** Fork（almanac ALMNC-89）：已結束（封存）的專案。 */
  archivedProjects: ArchivedProjectMap
  /** 結束專案：封存同名專案筆記、從進行中清單與目前脈絡移走；對話與分組留著。回傳封存了幾則專案筆記。 */
  endProject: (project: string, options?: { notePath?: string }) => Promise<{ notes: number, failed: string[] }>
  /**
   * 取消封存：專案筆記改回原本的狀態、回到進行中清單。
   * 沒有封存紀錄（例如在屬性面板手動改成 archived）但給了 notePath：只把那篇的 archived 拿掉。
   */
  reopenProject: (project: string, options?: { notePath?: string }) => Promise<{ failed: string[] }>

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
  /** Fork（almanac ALMNC-54.7）：掛一行直接修改的確認卡；undo 只放記憶體（同卡片本身）。 */
  attachDirectEdit: (chatId: number, card: DirectEditCardData, undo: () => Promise<boolean>) => void
  /** Fork（almanac ALMNC-54.7）：右側欄指揮官參與的對話標成「處理」。 */
  markCommanderThread: (conversation: ConversationRef) => Promise<void>
  actOnCard: (chatId: number, cardId: string, action: CardAction) => Promise<void>
}

type ConversationRef = Pick<Conversation, 'id' | 'syncId'>

/** Fork（almanac ALMNC-54.7）：直接修改卡片的復原函式（卡片 id → 復原）。 */
const undoers = new Map<string, () => Promise<boolean>>()

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
      const [map, tags, archived] = await Promise.all([loadProjectMap(), loadTagMap(), loadArchivedProjects()])
      // 載入期間使用者可能已經移動過對話：以已有的為準
      set(state => ({
        projectMap: { ...map, ...state.projectMap },
        tagMap: { ...tags, ...state.tagMap },
        archivedProjects: { ...archived, ...state.archivedProjects },
        projectsLoaded: true,
      }))
    },
    moveToProject: async (key, project) => persist(assignProject(get().projectMap, key, project)),
    renameProject: async (from, to) => persist(renameProject(get().projectMap, from, to)),
    removeProject: async project => persist(dropProject(get().projectMap, project)),

    archivedProjects: {},
    endProject: async (project, options) => {
      // 先確定封存清單讀回來了，免得只用這一筆蓋掉 store.json 裡的整張表。
      await get().loadProjects()
      const { record, failed } = await archiveProject(project, createProjectArchiveDeps(), options?.notePath ? [options.notePath] : [])
      const next = { ...get().archivedProjects, [record.name]: record }
      set({ archivedProjects: next })
      await saveArchivedProjects(next)
      return { notes: record.notes.length, failed }
    },
    reopenProject: async (project, options) => {
      await get().loadProjects()
      const record = findArchivedProject(get().archivedProjects, project)
      if (!record) {
        if (!options?.notePath) return { failed: [] }
        return restoreProject({ name: project, archivedAt: 0, notes: [{ path: options.notePath, previousStatus: null }], context: [] }, createProjectArchiveDeps())
      }
      const next = { ...get().archivedProjects }
      delete next[record.name]
      set({ archivedProjects: next })
      await saveArchivedProjects(next)
      return restoreProject(record, createProjectArchiveDeps())
    },

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
    attachDirectEdit: (chatId, card, undo) => {
      undoers.set(card.id, undo)
      get().attachCard(chatId, card)
    },
    markCommanderThread: async conversation => {
      // 有指揮官參與就是「處理」（lib/threads/tags.ts tagFromParticipants）。已經是處理就不寫。
      // 先確定對照表讀回來了，免得只用這一筆蓋掉 store.json 裡的整張表。
      await get().loadProjects()
      if (get().tagMap[keyOf(conversation)] === 'process') return
      await persistTags(assignTag(get().tagMap, keyOf(conversation), 'process'))
    },
    actOnCard: async (chatId, cardId, action) => {
      const card = get().cards[chatId]?.find(entry => entry.id === cardId)
      if (!card) return
      if (card.type === 'direct-edit') {
        const undo = undoers.get(card.id)
        if (action !== 'undo' || card.status !== 'done' || !undo) return
        const ok = await undo()
        undoers.delete(card.id)
        const next: DirectEditCardData = { ...card, status: ok ? 'undone' : 'stale' }
        set(state => ({ cards: { ...state.cards, [chatId]: (state.cards[chatId] ?? []).map(entry => entry.id === cardId ? next : entry) } }))
        return
      }
      // 提案卡連著收集頁的提案時，接受／放棄走收集頁的流程（會寫筆記檔或今日日誌）。
      if (card.type === 'proposal' && card.source) {
        const key = threadProposalKey(card)
        const trail = useProposalTrailStore.getState().trail[key]
        if (trail?.discussion || trail?.supersededBy) return
        const collect = useCollectStore.getState()
        if (action === 'accept') {
          const proposal = collect.items.find(item => item.id === card.source!.itemId)?.proposals.find(entry => entry.id === card.source!.proposalId)
          const result = await collect.accept(card.source.itemId, card.source.proposalId)
          // Fork（almanac ALMNC-54.21）：接受後記一筆活動紀錄（誰提的、改了什麼、來源對話）。
          if (proposal) {
            const [{ acceptedFromProposal, logAcceptedProposal }, { newNoteChanges }, { default: useDailySettingsStore }] = await Promise.all([
              import('@/lib/proposals/accepted-activity'), import('@/lib/workbench/new-note'), import('@/stores/daily-settings'),
            ])
            // Fork（almanac ALMNC-69.2）：改過標題或位置的新增筆記，活動紀錄記「原建議 → 你的修改」。
            const changes = newNoteChanges(proposal, useDailySettingsStore.getState().inboxFolder)
            await logAcceptedProposal(acceptedFromProposal(key, proposal, result.path, changes))
          }
        }
        if (action === 'reject') collect.reject(card.source.itemId, card.source.proposalId)
      }
      const next = applyCardAction(card, action)
      if (next === card) return
      set(state => ({ cards: { ...state.cards, [chatId]: (state.cards[chatId] ?? []).map(entry => entry.id === cardId ? next : entry) } }))
    },
  }
})

export default useThreadsStore
