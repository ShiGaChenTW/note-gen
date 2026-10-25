// Fork（#31）：首頁的顯示狀態與卡片設定。設定存在 store.json，不進 vault。
import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { EMPTY_PREFS, normalizePrefs, type HomeCardMeta, type HomeCardPrefs } from '@/lib/home/cards'
import { DEFAULT_SIGNAL_RULES, normalizeSignalRules, type SignalRules } from '@/lib/home/signals'

export const HOME_CARDS_KEY = 'homeCards'
export const HOME_ON_STARTUP_KEY = 'homeShowOnStartup'
export const HOME_SIGNAL_RULES_KEY = 'homeSignalRules'

/** 「交給 Agent」前讓使用者看一眼、改一改的預填指令。 */
export interface HandoffDraft {
  title: string
  prompt: string
  kind: 'signal' | 'suggestion' | 'chat'
  /** 任務建立後呼叫（#35：記下優化建議交給了哪個任務）。 */
  onStarted?: (taskId: string) => void
}

interface HomeState {
  visible: boolean
  loaded: boolean
  showOnStartup: boolean
  prefs: HomeCardPrefs
  editing: boolean
  signalRules: SignalRules
  handoff: HandoffDraft | null
  init: (cards: HomeCardMeta[]) => Promise<void>
  show: () => void
  hide: () => void
  toggle: () => void
  setEditing: (editing: boolean) => void
  setPrefs: (prefs: HomeCardPrefs) => Promise<void>
  setShowOnStartup: (value: boolean) => Promise<void>
  setSignalRules: (rules: SignalRules) => Promise<void>
  setHandoff: (draft: HandoffDraft | null) => void
}

async function persist(key: string, value: unknown) {
  try {
    const store = await Store.load('store.json')
    await store.set(key, value)
    await store.save()
  } catch (error) {
    console.error('[home] failed to save settings:', error)
  }
}

const useHomeStore = create<HomeState>((set, get) => ({
  visible: false,
  loaded: false,
  showOnStartup: true,
  prefs: EMPTY_PREFS,
  editing: false,
  signalRules: DEFAULT_SIGNAL_RULES,
  handoff: null,

  init: async cards => {
    if (get().loaded) return
    let saved: unknown
    let savedRules: unknown
    let showOnStartup = true
    try {
      const store = await Store.load('store.json')
      saved = await store.get(HOME_CARDS_KEY)
      savedRules = await store.get(HOME_SIGNAL_RULES_KEY)
      showOnStartup = (await store.get<boolean>(HOME_ON_STARTUP_KEY)) ?? true
    } catch {
      // 讀不到設定就用預設：顯示首頁、卡片照登記順序
    }
    set({
      loaded: true,
      showOnStartup,
      prefs: normalizePrefs(saved, cards),
      signalRules: normalizeSignalRules(savedRules),
      visible: showOnStartup,
    })
  },
  show: () => set({ visible: true }),
  hide: () => set({ visible: false, editing: false }),
  toggle: () => set(state => ({ visible: !state.visible, editing: false })),
  setEditing: editing => set({ editing }),
  setPrefs: async prefs => {
    set({ prefs })
    await persist(HOME_CARDS_KEY, prefs)
  },
  setShowOnStartup: async value => {
    set({ showOnStartup: value })
    await persist(HOME_ON_STARTUP_KEY, value)
  },
  setSignalRules: async rules => {
    set({ signalRules: rules })
    await persist(HOME_SIGNAL_RULES_KEY, rules)
  },
  setHandoff: draft => set({ handoff: draft }),
}))

export default useHomeStore
