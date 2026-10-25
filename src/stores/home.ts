// Fork（#31）：首頁的顯示狀態與卡片設定。設定存在 store.json，不進 vault。
import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { EMPTY_PREFS, normalizePrefs, type HomeCardMeta, type HomeCardPrefs } from '@/lib/home/cards'

export const HOME_CARDS_KEY = 'homeCards'
export const HOME_ON_STARTUP_KEY = 'homeShowOnStartup'

interface HomeState {
  visible: boolean
  loaded: boolean
  showOnStartup: boolean
  prefs: HomeCardPrefs
  editing: boolean
  init: (cards: HomeCardMeta[]) => Promise<void>
  show: () => void
  hide: () => void
  toggle: () => void
  setEditing: (editing: boolean) => void
  setPrefs: (prefs: HomeCardPrefs) => Promise<void>
  setShowOnStartup: (value: boolean) => Promise<void>
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

  init: async cards => {
    if (get().loaded) return
    let saved: unknown
    let showOnStartup = true
    try {
      const store = await Store.load('store.json')
      saved = await store.get(HOME_CARDS_KEY)
      showOnStartup = (await store.get<boolean>(HOME_ON_STARTUP_KEY)) ?? true
    } catch {
      // 讀不到設定就用預設：顯示首頁、卡片照登記順序
    }
    set({ loaded: true, showOnStartup, prefs: normalizePrefs(saved, cards), visible: showOnStartup })
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
}))

export default useHomeStore
