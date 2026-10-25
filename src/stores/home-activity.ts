// Fork（#32）：本週足跡的紀錄。存在 app 端的 home-activity.json，不進 vault；只記日期、路徑、事件。
import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { emptyLog, normalizeLog, pruneLog, recordActivity, type ActivityKind, type ActivityLog } from '@/lib/home/activity'

const FILE = 'home-activity.json'
const KEY = 'log'

interface HomeActivityState {
  log: ActivityLog
  loaded: boolean
  load: () => Promise<void>
  record: (kind: ActivityKind, paths: string[]) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(log: ActivityLog) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void (async () => {
      try {
        const store = await Store.load(FILE)
        await store.set(KEY, log)
        await store.save()
      } catch (error) {
        console.error('[home-activity] failed to save:', error)
      }
    })()
  }, 2000)
}

const useHomeActivityStore = create<HomeActivityState>((set, get) => ({
  log: emptyLog(),
  loaded: false,
  load: async () => {
    if (get().loaded) return
    let saved: unknown
    try {
      saved = await (await Store.load(FILE)).get(KEY)
    } catch {
      // 第一次使用沒有檔案
    }
    set({ loaded: true, log: pruneLog(normalizeLog(saved), new Date()) })
  },
  record: (kind, paths) => {
    if (!get().loaded || paths.length === 0) return
    const now = new Date()
    let log = get().log
    for (const path of paths) log = recordActivity(log, kind, path, now)
    log = pruneLog(log, now)
    if (log === get().log) return
    set({ log })
    scheduleSave(log)
  },
}))

export default useHomeActivityStore
