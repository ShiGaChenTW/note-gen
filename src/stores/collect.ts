// Fork（almanac ALMNC-8）：收集頁的狀態。做法同 Inbox、提示詞庫頁：同一時間只開一個全頁覆蓋層。
// 收集項目與提案保存在 store.json 的 collectItems（ALMNC-10：還沒收下的提案關頁、重開後還在，「等你定」才讀得到）；
// 收下的東西寫進筆記檔與今日日誌，不另開資料表。
import { create } from 'zustand'
import { askCollectModel } from '@/lib/collect/ai'
import { loadItems, mergeItems, saveItems } from '@/lib/collect/persist'
import { splitInput } from '@/lib/collect/split'
import { acceptProposal, undoAccepted, type AcceptResult } from '@/lib/collect/write'
import { collectLinkCandidate } from '@/lib/workbench/auto-accept-sources'
import { linkEditOf } from '@/lib/workbench/auto-accept'
import type { OpContext } from '@/lib/ops/types'
import { linkAcceptedOutputs } from '@/lib/commander/consolidate'

/** Fork（almanac ALMNC-69.3）：替資料源貼上日誌標籤（已經有的不動），貼完重讀資料源分頁。ALMNC-65.2：批次卡整批接受時只貼一次。 */
export async function applyJournalTag(sourceIds: readonly string[]): Promise<void> {
  const db = await import('@/db/v3-sources')
  for (const id of new Set(sourceIds)) await db.setSourceJournal(id, true)
  const { refreshSources } = await import('@/lib/workbench/actions')
  await refreshSources()
}
import type { CollectInput, Proposal, SplitSource } from '@/lib/collect/types'
import { setRecordsProcessed } from '@/lib/inbox/actions'
import { replacedProposalKeys } from '@/lib/proposals/trail'
import { retargetNewNote, type NewNoteTarget } from '@/lib/workbench/new-note'
import { useUiModeStore } from '@/lib/fork-ui'
import useDailySettingsStore from './daily-settings'
import useHomeStore from './home'
import useInboxStore from './inbox'
import usePromptLibraryStore from './prompt-library'
import useProposalTrailStore from './proposals'
import useSettingStore from './setting'

export type ProposalStatus = 'wait' | 'ok' | 'no'

export interface CaptureProposal extends Proposal {
  status: ProposalStatus
  result?: AcceptResult
}

export interface CaptureItem {
  id: string
  input: CollectInput
  createdAt: number
  state: 'reading' | 'ready'
  source?: SplitSource
  proposals: CaptureProposal[]
  /** 從 Inbox 拆進來的既有記錄；提案處理完時把它標成已整理。 */
  recordId?: number
}

interface CollectState {
  visible: boolean
  items: CaptureItem[]
  /** 從 store.json 讀回保存的項目（只做一次；讀回前不寫檔，免得把還沒讀到的內容蓋掉）。 */
  hydrate: () => Promise<void>
  persist: () => Promise<void>
  show: () => void
  hide: () => void
  submit: (input: CollectInput, options?: { recordId?: number }) => Promise<void>
  /** Fork（almanac ALMNC-54.5）：conversationId＝這批提案來自哪段對話（沒有自帶的才補上）。 */
  addProposals: (id: string, origin: string, proposals: Proposal[], options?: { conversationId?: number, recordId?: number }) => Promise<void>
  /** journalTag: false＝這次不貼日誌標籤（ALMNC-65.2 批次卡整批接受，最後一起貼一次）。 */
  accept: (itemId: string, proposalId: string, options?: { journalTag?: boolean, ops?: OpContext }) => Promise<AcceptResult>
  reject: (itemId: string, proposalId: string) => void
  /** Fork（almanac ALMNC-54.8）：工作台「復原」放棄——把放棄的提案改回等你決定。 */
  restore: (itemId: string, proposalId: string) => void
  edit: (itemId: string, proposalId: string, patch: Partial<Pick<Proposal, 'title' | 'due' | 'time'>>) => void
  /** Fork（almanac ALMNC-54.21）：新增筆記的提案，接受前在工作台卡片上改標題與存放位置（lib/workbench/new-note.ts）。 */
  retarget: (itemId: string, proposalId: string, edit: NewNoteTarget, inboxFolder: string) => void
  undo: (itemId: string, proposalId: string) => Promise<boolean>
  /** Fork（almanac ALMNC-69.9）：寫入已由 ops 復原，把提案改回等你決定。 */
  reopen: (itemId: string, proposalId: string) => void
  remove: (itemId: string) => void
}

let itemCounter = 0
const submissions = new Map<string, Promise<void>>()
let hydration: Promise<void> | undefined
let persistReady = false
let pendingSave = Promise.resolve()
let persistTimer: ReturnType<typeof setTimeout> | undefined

function patchProposal(items: CaptureItem[], itemId: string, proposalId: string, patch: Partial<CaptureProposal>): CaptureItem[] {
  return items.map(item => item.id !== itemId ? item : {
    ...item,
    proposals: item.proposals.map(proposal => proposal.id === proposalId ? { ...proposal, ...patch } : proposal),
  })
}

function decisionBlocked(items: CaptureItem[], itemId: string, proposalId: string): boolean {
  const key = `collect:${itemId}:${proposalId}`
  const entry = useProposalTrailStore.getState().trail[key]
  return Boolean(entry?.discussion || entry?.supersededBy || replacedProposalKeys(items).has(key))
}

const useCollectStore = create<CollectState>((set, get) => ({
  visible: false,
  items: [],
  show: () => {
    useHomeStore.getState().hide()
    useInboxStore.getState().hide()
    usePromptLibraryStore.getState().hide()
    set({ visible: true })
  },
  hide: () => set({ visible: false }),

  hydrate: () => hydration ??= loadItems(Date.now())
    .then(restored => {
      set(state => ({ items: mergeItems(state.items, restored as CaptureItem[]) }))
      persistReady = true
    })
    .catch(error => {
      // 沒有 Tauri（瀏覽器預覽）或讀檔失敗：本次只放記憶體，也不寫檔
      hydration = undefined
      console.debug('[collect] restore skipped:', error)
    }),

  persist: () => {
    if (!persistReady) return Promise.reject(new Error('Collect store is not loaded'))
    clearTimeout(persistTimer)
    const saved = pendingSave.then(() => saveItems(get().items))
    pendingSave = saved.catch(() => undefined)
    return saved
  },

  submit: async (input, options) => {
    itemCounter += 1
    const id = `capture-${Date.now().toString(36)}-${itemCounter}`
    set(state => ({ items: [{ id, input, createdAt: Date.now(), state: 'reading', proposals: [], recordId: options?.recordId }, ...state.items] }))
    const { proposals, source } = await splitInput(input, new Date(), askCollectModel)
    set(state => ({
      items: state.items.map(item => item.id === id
        ? { ...item, state: 'ready', source, proposals: proposals.map(proposal => ({ ...proposal, status: 'wait' as const })) }
        : item),
    }))
  },

  addProposals: (id, origin, proposals, options) => {
    const pending = submissions.get(id)
    if (pending) return pending
    if (!proposals.length || get().items.some(item => item.id === id)) return Promise.resolve()

    const entries: CaptureProposal[] = proposals.map(proposal => ({
      ...proposal,
      ...(proposal.conversationId === undefined && options?.conversationId !== undefined ? { conversationId: options.conversationId } : {}),
      status: 'wait',
    }))
    const publish = () => set(state => state.items.some(item => item.id === id) ? state : {
      items: [{
        id,
        input: { kind: 'text', text: '', name: origin },
        createdAt: Date.now(),
        state: 'ready',
        source: 'ai',
        ...(options?.recordId !== undefined ? { recordId: options.recordId } : {}),
        proposals: entries,
      }, ...state.items],
    })

    const candidates = options?.recordId !== undefined ? [] : entries.flatMap((proposal, index) => {
      const candidate = collectLinkCandidate(id, proposal)
      const edit = candidate && linkEditOf(candidate)
      return edit ? [{ candidate, path: edit.path, index }] : []
    })
    if (!candidates.length) {
      publish()
      return Promise.resolve()
    }

    const workspace = useSettingStore.getState().workspacePath || ''
    const submission = (async () => {
      const { autoAcceptWorkspace, autoAcceptLink } = await import('@/lib/workbench/auto-accept-runtime')
      if (autoAcceptWorkspace() !== workspace) return
      for (const { candidate, path, index } of candidates) {
        if (await autoAcceptLink(candidate, workspace)) {
          entries[index] = { ...entries[index], status: 'ok', result: { path } }
        }
      }
    })().catch(error => console.debug('[collect] auto-accept unavailable:', error))
      .then(publish)
      .finally(() => { submissions.delete(id) })
    submissions.set(id, submission)
    return submission
  },

  accept: async (itemId, proposalId, options) => {
    const item = get().items.find(entry => entry.id === itemId)
    const proposal = item?.proposals.find(entry => entry.id === proposalId)
    if (!item || !proposal || proposal.status !== 'wait' || decisionBlocked(get().items, itemId, proposalId)) throw new Error('proposal not found')
    await useDailySettingsStore.getState().initSettings()
    if (decisionBlocked(get().items, itemId, proposalId)) throw new Error('proposal is being revised or replaced')
    const result = await acceptProposal(proposal, { noteFolder: useDailySettingsStore.getState().inboxFolder, ...(options?.ops ? { ops: options.ops } : {}) })
    set(state => ({ items: patchProposal(state.items, itemId, proposalId, { status: 'ok', result }) }))
    // Fork（almanac ALMNC-54.6）：指揮官的提案接受、寫入之後才建立「資料源 → 產出」連結；筆記 frontmatter 的 sources 已同時寫好，
    // 連結表寫失敗也查得到來源（lib/v3-model/links.ts sourcesOfNote 取聯集），所以只記錯、不擋接受。
    if (proposal.sourceIds?.length) {
      await linkAcceptedOutputs(proposal, result).catch(error => console.error('[collect] source output link failed:', error))
    }
    // Fork（almanac ALMNC-69.3）：指揮官「判斷為日誌」隨 Scott 接受一起生效。寫失敗只記錯，不擋已經寫好的筆記。
    if (options?.journalTag !== false && proposal.journalTag && proposal.sourceIds?.length) {
      await applyJournalTag(proposal.sourceIds).catch(error => console.error('[collect] journal tag failed:', error))
    }
    // Fork（almanac ALMNC-54.12）：新筆記寫入後，負責的專家在背景比對同領域的類似筆記（發現時機 1）；不擋接受。
    if (proposal.kind === 'note' && !proposal.slot && !proposal.change && !proposal.edits?.length && !proposal.review && result.path) {
      void import('@/lib/cleanup/runtime').then(module => module.checkAfterWrite(result.path, 'written')).catch(() => undefined)
    }
    if (item.recordId !== undefined) {
      const items = get().items
      const replaced = replacedProposalKeys(items)
      const { trail } = useProposalTrailStore.getState()
      const proposals = items.filter(entry => entry.recordId === item.recordId)
        .flatMap(entry => entry.proposals.filter(p => {
          const key = `collect:${entry.id}:${p.id}`
          return !replaced.has(key) && !trail[key]?.supersededBy
        }))
      if (proposals.every(entry => entry.status !== 'wait')) {
        const note = proposals.find(entry => entry.status === 'ok' && entry.kind === 'note')
        await setRecordsProcessed([item.recordId], note?.result?.path ?? null).catch(error => console.error('[collect] mark record processed failed:', error))
      }
    }
    return result
  },

  reject: (itemId, proposalId) => set(state => decisionBlocked(state.items, itemId, proposalId)
    ? state : { items: patchProposal(state.items, itemId, proposalId, { status: 'no' }) }),

  restore: (itemId, proposalId) => set(state => ({
    items: state.items.map(item => item.id !== itemId ? item : {
      ...item,
      proposals: item.proposals.map(proposal => proposal.id === proposalId && proposal.status === 'no' ? { ...proposal, status: 'wait' as const } : proposal),
    }),
  })),

  edit: (itemId, proposalId, patch) => set(state => ({ items: patchProposal(state.items, itemId, proposalId, patch) })),
  retarget: (itemId, proposalId, edit, inboxFolder) => set(state => {
    const proposal = state.items.find(item => item.id === itemId)?.proposals.find(entry => entry.id === proposalId)
    if (!proposal || proposal.status !== 'wait') return state
    const next = retargetNewNote(proposal, edit, inboxFolder)
    return next === proposal ? state : { items: patchProposal(state.items, itemId, proposalId, next) }
  }),

  undo: async (itemId, proposalId) => {
    const proposal = get().items.find(entry => entry.id === itemId)?.proposals.find(entry => entry.id === proposalId)
    if (!proposal?.result) return false
    const undone = await undoAccepted(proposal.result)
    if (undone) set(state => ({ items: patchProposal(state.items, itemId, proposalId, { status: 'wait', result: undefined }) }))
    return undone
  },

  reopen: (itemId, proposalId) => set(state => ({ items: patchProposal(state.items, itemId, proposalId, { status: 'wait', result: undefined }) })),

  remove: itemId => set(state => ({ items: state.items.filter(item => item.id !== itemId) })),
}))

// 項目有變動就存檔（延遲 300 ms 合併連續變動）。
useCollectStore.subscribe((state, previous) => {
  if (!persistReady || state.items === previous.items) return
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    useCollectStore.getState().persist().catch(error => console.error('[collect] save failed:', error))
  }, 300)
})

// 其他全頁覆蓋層打開時收起收集頁；切回舊介面時也收起。
useHomeStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) useCollectStore.getState().hide()
})
useInboxStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) useCollectStore.getState().hide()
})
usePromptLibraryStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) useCollectStore.getState().hide()
})
useUiModeStore.subscribe((state) => {
  if (state.mode !== 'v3') useCollectStore.getState().hide()
})

export default useCollectStore
