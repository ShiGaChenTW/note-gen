// Fork（almanac ALMNC-54.5）：提案的來龍去脈對照表（再次討論、來源對話、取代關係），存在 store.json 的 proposalTrail。
// 提案本身不在這裡：清單仍由 lib/decide/project.ts 從各來源投影，這裡只補來源沒有的欄位。純函式在 lib/proposals/trail.ts。
import { create } from 'zustand'
import { loadTrail, saveTrail, startDiscussion, supersede, type ProposalTrail } from '@/lib/proposals/trail'

interface ProposalTrailState {
  trail: ProposalTrail
  /** 從 store.json 讀回（只做一次；讀回前不寫檔，免得蓋掉還沒讀到的內容）。 */
  hydrate: () => Promise<void>
  /** 再次討論：記下說明與要回到的對話；說明是空的不動，回傳是否有記下。 */
  discuss: (key: string, conversationId: number, note: string) => boolean
  clearDiscussion: (key: string) => void
  /** 指揮官修改後重新提案：舊提案標成被取代。 */
  supersede: (oldKey: string, newKey: string) => void
}

let hydration: Promise<void> | undefined
let persistReady = false
let pendingSave = Promise.resolve()

const useProposalTrailStore = create<ProposalTrailState>((set, get) => ({
  trail: {},
  hydrate: () => hydration ??= loadTrail()
    .then(restored => {
      // 讀回期間已經有的變動優先
      set(state => ({ trail: { ...restored, ...state.trail } }))
      persistReady = true
    })
    .catch(error => {
      hydration = undefined
      console.debug('[proposals] restore skipped:', error)
    }),
  discuss: (key, conversationId, note) => {
    const next = startDiscussion(get().trail, key, { note, conversationId, at: Date.now() })
    if (next === get().trail) return false
    set({ trail: next })
    return true
  },
  clearDiscussion: key => set(state => {
    const entry = state.trail[key]
    if (!entry?.discussion || entry.supersededBy) return state
    return { trail: { ...state.trail, [key]: { conversationId: entry.conversationId } } }
  }),
  supersede: (oldKey, newKey) => set(state => ({ trail: supersede(state.trail, oldKey, newKey) })),
}))

useProposalTrailStore.subscribe((state, previous) => {
  if (!persistReady || state.trail === previous.trail) return
  pendingSave = pendingSave.then(() => saveTrail(state.trail)).catch(error => console.error('[proposals] save failed:', error))
})

export default useProposalTrailStore
