// Fork（almanac ALMNC-54.8）：工作台的畫面狀態——兩個分頁（審核／資料源）、標籤篩選、游標與展開、先放著、復原堆疊、
// 資料源分頁的勾選與編輯、檯面（專注模式）。頁面開關沿用 useDecideStore.visible（側欄「工作台」＝原「等你定」入口）。
// 卡片與資料源清單本身不存在這裡：都是從來源現況投影（lib/workbench/cards.ts、sources-tab.ts）。
import { create } from 'zustand'
import type { LabelFilter, WorkbenchCard } from '@/lib/workbench/cards'
import { loadAside, putAside, saveAside, takeBack, type AsideMap } from '@/lib/workbench/put-aside'
import type { SourceFilter } from '@/lib/workbench/sources-tab'
import type { DeskMaterial } from '@/lib/workbench/desk'
import type { Source } from '@/lib/v3-model/source'
import type { SourceJudgement } from '@/lib/workbench/judgement'
import type { LegacyPack } from '@/lib/migration/legacy'

/** Fork（almanac ALMNC-54.14）：舊筆記批次（R3）的現況，從資料源表與 legacy_undecided 讀來。 */
export interface LegacyState {
  /** 已標記的舊筆記資料源 id（判斷筆記庫裡哪些還沒標）。 */
  markedIds: Set<string>
  total: number
  processed: number
  /** 最早標記的時間；還沒標過是 undefined。 */
  firstMarkedAt?: number
  /** 還沒整理好的包，舊的在前。 */
  packs: LegacyPack[]
  running: boolean
  pausing: boolean
}

export const EMPTY_LEGACY: LegacyState = { markedIds: new Set(), total: 0, processed: 0, packs: [], running: false, pausing: false }

export type WorkbenchTab = 'review' | 'sources'

export interface UndoEntry {
  /** toast 上的那句話。 */
  message: string
  /** 沒有就代表這一步無法復原（例如已交給指揮官分析）。 */
  undo?: () => Promise<unknown> | unknown
  /** 復原後游標回到哪張卡。 */
  cardKey?: string
}

export interface DeskState {
  open: boolean
  materials: DeskMaterial[]
  /** 從哪張卡攤開的（清單上標「檯面上」）。 */
  cardKey?: string
  /** 協助欄的處理對話。 */
  conversationId?: number
}

interface WorkbenchState {
  tab: WorkbenchTab
  setTab: (tab: WorkbenchTab) => void

  // —— 審核 ——
  filter: LabelFilter
  setFilter: (filter: LabelFilter) => void
  cursor: string | null
  setCursor: (key: string | null) => void
  /** 就地展開的卡片。 */
  expanded: string | null
  setExpanded: (key: string | null) => void
  /** 剛處理完、正在收起的卡片（動畫期間還留在清單上）。 */
  leaving: string[]
  setLeaving: (key: string, on: boolean) => void
  aside: AsideMap
  hydrateAside: () => Promise<void>
  putAside: (card: Pick<WorkbenchCard, 'key' | 'title'>, until?: string) => void
  takeBack: (key: string) => void
  showAside: boolean
  setShowAside: (value: boolean) => void
  /** 放棄的領域提案 id（來源是即時計算，沒有地方記「不要」）。 */
  dismissed: string[]
  dismiss: (id: string) => void
  undismiss: (id: string) => void
  history: UndoEntry[]
  pushUndo: (entry: UndoEntry) => void
  popUndo: () => UndoEntry | undefined

  // —— 資料源 ——
  sourceFilter: SourceFilter
  setSourceFilter: (filter: SourceFilter) => void
  picked: Set<string>
  setPicked: (picked: Set<string>) => void
  selectedRow: string | null
  selectRow: (id: string | null) => void
  editing: boolean
  setEditing: (value: boolean) => void
  /** 改過、還沒送給指揮官的資料源 id。 */
  edited: Set<string>
  markEdited: (sourceId: string, on: boolean) => void
  sources: Source[]
  outputCounts: Map<string, number>
  sourcesLoaded: boolean
  setSources: (sources: Source[], outputCounts: Map<string, number>) => void
  /** Fork（almanac ALMNC-54.10）：外部擷取資料源的初步判斷（資料源 id → 判斷）。 */
  judgements: Map<string, SourceJudgement>
  setJudgements: (judgements: Map<string, SourceJudgement>) => void
  /** Fork（almanac ALMNC-54.14）：舊筆記批次。 */
  legacy: LegacyState
  setLegacy: (patch: Partial<LegacyState>) => void

  // —— 檯面 ——
  desk: DeskState
  openDesk: (materials: DeskMaterial[], cardKey?: string) => void
  setDeskConversation: (id: number) => void
  setDeskMaterials: (materials: DeskMaterial[]) => void
  closeDesk: () => void
}

let asideHydration: Promise<void> | undefined
let asideReady = false

const CLOSED_DESK: DeskState = { open: false, materials: [] }

const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  tab: 'review',
  setTab: tab => set({ tab, editing: false }),

  filter: 'all',
  setFilter: filter => set({ filter, expanded: null, cursor: null }),
  cursor: null,
  setCursor: cursor => set({ cursor }),
  expanded: null,
  setExpanded: expanded => set({ expanded }),
  leaving: [],
  setLeaving: (key, on) => set(state => ({ leaving: on ? [...state.leaving.filter(k => k !== key), key] : state.leaving.filter(k => k !== key) })),
  aside: {},
  hydrateAside: () => asideHydration ??= loadAside()
    .then(restored => {
      set(state => ({ aside: { ...restored, ...state.aside } }))
      asideReady = true
    })
    .catch(error => {
      asideHydration = undefined
      console.debug('[workbench] aside restore skipped:', error)
    }),
  putAside: (card, until) => set(state => ({ aside: putAside(state.aside, card, Date.now(), until) })),
  takeBack: key => set(state => ({ aside: takeBack(state.aside, key) })),
  showAside: false,
  setShowAside: showAside => set({ showAside }),
  dismissed: [],
  dismiss: id => set(state => ({ dismissed: state.dismissed.includes(id) ? state.dismissed : [...state.dismissed, id] })),
  undismiss: id => set(state => ({ dismissed: state.dismissed.filter(entry => entry !== id) })),
  history: [],
  pushUndo: entry => set(state => ({ history: [...state.history.slice(-19), entry] })),
  popUndo: () => {
    const history = get().history
    const last = history[history.length - 1]
    if (last) set({ history: history.slice(0, -1) })
    return last
  },

  sourceFilter: 'all',
  setSourceFilter: sourceFilter => set({ sourceFilter }),
  picked: new Set(),
  setPicked: picked => set({ picked }),
  selectedRow: null,
  selectRow: selectedRow => set({ selectedRow, editing: false }),
  editing: false,
  setEditing: editing => set({ editing }),
  edited: new Set(),
  markEdited: (sourceId, on) => set(state => {
    const edited = new Set(state.edited)
    if (on) edited.add(sourceId)
    else edited.delete(sourceId)
    return { edited }
  }),
  sources: [],
  outputCounts: new Map(),
  sourcesLoaded: false,
  setSources: (sources, outputCounts) => set({ sources, outputCounts, sourcesLoaded: true }),
  judgements: new Map(),
  setJudgements: judgements => set({ judgements }),
  legacy: EMPTY_LEGACY,
  setLegacy: patch => set(state => ({ legacy: { ...state.legacy, ...patch } })),

  desk: CLOSED_DESK,
  openDesk: (materials, cardKey) => set({ desk: { open: true, materials, ...(cardKey ? { cardKey } : {}) } }),
  setDeskConversation: id => set(state => ({ desk: { ...state.desk, conversationId: id } })),
  setDeskMaterials: materials => set(state => ({ desk: { ...state.desk, materials } })),
  closeDesk: () => set({ desk: CLOSED_DESK }),
}))

useWorkbenchStore.subscribe((state, previous) => {
  if (!asideReady || state.aside === previous.aside) return
  saveAside(state.aside).catch(error => console.error('[workbench] aside save failed:', error))
})

export default useWorkbenchStore
