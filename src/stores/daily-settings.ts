// Fork (D1): daily-note settings, kept out of the upstream setting.ts.
import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { DAILY_DEFAULTS, isValidDailyPattern } from '@/lib/daily/format'
import type { WeekdayKey } from '@/lib/daily/template'

export interface DailySettings {
  /** Folder of daily notes, relative to the workspace. */
  dailyFolder: string
  /** File name pattern, e.g. `YYYYMMDD`. */
  dailyPattern: string
  inboxFolder: string
  staleDays: number
  /** Template note path; empty means a blank note. */
  defaultTemplate: string
  weekdayTemplates: Partial<Record<WeekdayKey, string>>
  /** Open (and create if missing) today's note once per app launch. */
  openOnLaunch: boolean
  /** D7: macOS notifications for tasks with `⏰ HH:mm`. */
  remindersEnabled: boolean
}

export const DEFAULT_DAILY_SETTINGS: DailySettings = {
  ...DAILY_DEFAULTS,
  defaultTemplate: '',
  weekdayTemplates: {},
  openOnLaunch: true,
  remindersEnabled: true,
}

const STORE_KEY = 'dailySettings'

interface DailySettingsState extends DailySettings {
  initialized: boolean
  initSettings: () => Promise<void>
  updateSetting: <K extends keyof DailySettings>(key: K, value: DailySettings[K]) => Promise<void>
}

function sanitize(saved: Partial<DailySettings> | null | undefined): DailySettings {
  const merged = { ...DEFAULT_DAILY_SETTINGS, ...(saved ?? {}) }
  if (!isValidDailyPattern(merged.dailyPattern)) merged.dailyPattern = DEFAULT_DAILY_SETTINGS.dailyPattern
  if (!Number.isFinite(merged.staleDays) || merged.staleDays < 0) merged.staleDays = DEFAULT_DAILY_SETTINGS.staleDays
  return merged
}

function pickSettings(state: DailySettings): DailySettings {
  return {
    dailyFolder: state.dailyFolder,
    dailyPattern: state.dailyPattern,
    inboxFolder: state.inboxFolder,
    staleDays: state.staleDays,
    defaultTemplate: state.defaultTemplate,
    weekdayTemplates: state.weekdayTemplates,
    openOnLaunch: state.openOnLaunch,
    remindersEnabled: state.remindersEnabled,
  }
}

const useDailySettingsStore = create<DailySettingsState>((set, get) => ({
  ...DEFAULT_DAILY_SETTINGS,
  initialized: false,

  initSettings: async () => {
    if (get().initialized) return
    const store = await Store.load('store.json')
    const saved = await store.get<Partial<DailySettings>>(STORE_KEY)
    set({ ...sanitize(saved), initialized: true })
  },

  updateSetting: async (key, value) => {
    set({ [key]: value } as Pick<DailySettings, typeof key>)
    const store = await Store.load('store.json')
    await store.set(STORE_KEY, pickSettings(get()))
    await store.save()
  },
}))

export default useDailySettingsStore
