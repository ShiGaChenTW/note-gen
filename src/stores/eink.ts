// Fork（almanac ALMNC-45）：電子紙的設定、釘選資料與行程私人標記。
// 全部存在 store.json（只在這台 Mac；設定同步永遠排除，見 src/config/sync-exclusions.ts）。
// 清單邏輯都在 src/lib/eink/*（純函式、有單元測試），這裡只負責讀寫與串接。
import { create } from 'zustand'
import {
  DEFAULT_EINK_SETTINGS, EINK_SETTINGS_KEY, EINK_TOKEN_KEY, generateEinkToken, isValidEinkToken, normalizeEinkSettings,
  type EinkSettings,
} from '@/lib/eink/settings'
import {
  EINK_PINS_KEY, applyPathDelete, applyPathMove, markPinsSent, movePinBy, normalizePins, removePin, togglePin, type EinkPin,
} from '@/lib/eink/pins'
import { EINK_PRIVATE_KEY, normalizePrivateItems, setPrivate } from '@/lib/eink/privacy'
import { persistEink, readEinkKeys } from '@/lib/eink/storage'

interface EinkState {
  loaded: boolean
  settings: EinkSettings
  token: string
  pins: EinkPin[]
  privateItems: string[]
  init: () => Promise<void>
  updateSettings: (patch: Partial<EinkSettings>) => Promise<void>
  regenerateToken: () => Promise<void>
  togglePin: (path: string) => Promise<void>
  removePin: (path: string) => Promise<void>
  movePin: (path: string, delta: -1 | 1) => Promise<void>
  handlePathMove: (oldPath: string, newPath: string) => Promise<void>
  handlePathDelete: (path: string, isFolder: boolean) => Promise<void>
  setPrivate: (key: string, on: boolean) => Promise<void>
  /** Fork（almanac ALMNC-47）：真的送到電子紙後記下送出日（只由今日簡報的 commitSent 呼叫）。 */
  markPinsSent: (paths: readonly string[], at: number) => Promise<void>
}

let loading: Promise<void> | null = null

const useEinkStore = create<EinkState>((set, get) => {
  async function ready() {
    if (!get().loaded) await get().init()
  }

  async function savePins(pins: EinkPin[]) {
    set({ pins })
    await persistEink(EINK_PINS_KEY, pins)
  }

  return {
    loaded: false,
    settings: DEFAULT_EINK_SETTINGS,
    token: '',
    pins: [],
    privateItems: [],

    init: async () => {
      if (get().loaded) return
      loading ??= (async () => {
        let saved: Record<string, unknown>
        try {
          saved = await readEinkKeys([EINK_SETTINGS_KEY, EINK_TOKEN_KEY, EINK_PINS_KEY, EINK_PRIVATE_KEY])
        } catch {
          // 讀不到就用預設值顯示，但不產生 token、不寫回，免得把讀不到的內容蓋掉
          set({ loaded: true })
          return
        }
        const savedToken = saved[EINK_TOKEN_KEY]
        const token = isValidEinkToken(savedToken) ? savedToken : generateEinkToken()
        set({
          loaded: true,
          settings: normalizeEinkSettings(saved[EINK_SETTINGS_KEY]),
          token,
          pins: normalizePins(saved[EINK_PINS_KEY]),
          privateItems: normalizePrivateItems(saved[EINK_PRIVATE_KEY]),
        })
        if (token !== savedToken) await persistEink(EINK_TOKEN_KEY, token)
      })().finally(() => { loading = null })
      await loading
    },

    updateSettings: async patch => {
      await ready()
      const settings = normalizeEinkSettings({ ...get().settings, ...patch })
      set({ settings })
      await persistEink(EINK_SETTINGS_KEY, settings)
    },

    regenerateToken: async () => {
      await ready()
      const token = generateEinkToken()
      set({ token })
      await persistEink(EINK_TOKEN_KEY, token)
    },

    togglePin: async path => {
      await ready()
      await savePins(togglePin(get().pins, path, Date.now()))
    },
    removePin: async path => {
      await ready()
      await savePins(removePin(get().pins, path))
    },
    movePin: async (path, delta) => {
      await ready()
      await savePins(movePinBy(get().pins, path, delta))
    },
    handlePathMove: async (oldPath, newPath) => {
      await ready()
      const current = get().pins
      const pins = applyPathMove(current, oldPath, newPath)
      if (pins.some((pin, index) => pin.path !== current[index]?.path) || pins.length !== current.length) await savePins(pins)
    },
    handlePathDelete: async (path, isFolder) => {
      await ready()
      const pins = applyPathDelete(get().pins, path, isFolder)
      if (pins.length !== get().pins.length) await savePins(pins)
    },

    markPinsSent: async (paths, at) => {
      await ready()
      if (paths.length === 0) return
      await savePins(markPinsSent(get().pins, paths, at))
    },

    setPrivate: async (key, on) => {
      await ready()
      const privateItems = setPrivate(get().privateItems, key, on)
      set({ privateItems })
      await persistEink(EINK_PRIVATE_KEY, privateItems)
    },
  }
})

/** 測試用：回到還沒讀檔的狀態。 */
export function resetEinkStoreForTest(): void {
  loading = null
  useEinkStore.setState({ loaded: false, settings: DEFAULT_EINK_SETTINGS, token: '', pins: [], privateItems: [] })
}

export default useEinkStore
