import { Store } from '@tauri-apps/plugin-store'
import { notifyStoreKeyWritten } from '@/lib/almanac-sync/notify'
import { create } from 'zustand'

const KEY = 'almanacAutoOrganize'

export const useOrganizeSettings = create<{
  enabled: boolean
  ready: boolean
  load: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
}>((set, get) => ({
  enabled: false,
  ready: false,
  load: async () => {
    if (get().ready) return
    const store = await Store.load('store.json')
    const enabled = await store.get(KEY) === true
    if (!get().ready) set({ enabled, ready: true })
  },
  setEnabled: async enabled => {
    const store = await Store.load('store.json')
    await store.set(KEY, enabled)
    await store.save()
    // Fork（almanac ALMNC-85.4）：帳號層級設定，寫入後排設定同步（直接 store.set 不會觸發上傳，設計 1.9）。
    notifyStoreKeyWritten(KEY)
    set({ enabled, ready: true })
  },
}))
