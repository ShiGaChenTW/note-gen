// Fork（almanac ALMNC-54.8）：先放著——一種狀態，不是區塊。任何卡片都能先放著，可以設提醒日期；
// 先放著的卡片預設隱藏，提醒日期到了才回到清單（第四節「排序與先放著」）。入口在審核分頁右上角，顯示「先放著 N 件」（v14）。
// 只記「哪張卡、放到哪天」，存在 store.json 的 workbenchAside；卡片本身仍由來源投影，來源處理掉了這筆記錄就沒有作用。
import type { WorkbenchCard } from './cards'
import { notifyStoreKeyWritten } from '@/lib/almanac-sync/notify'

export const PUT_ASIDE_KEY = 'workbenchAside'

export interface AsideEntry {
  /** 放著的時間（毫秒）。 */
  at: number
  /** 提醒日期 YYYY-MM-DD；沒有就一直放著，直到 Scott 拿回來。 */
  until?: string
  /** 顯示用：放著時的標的物（來源消失後清單上仍看得懂）。 */
  title: string
}

export type AsideMap = Record<string, AsideEntry>

function localDateKey(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 這筆先放著現在還藏著嗎？提醒日期當天（含）起回到清單。 */
export function isHidden(entry: AsideEntry | undefined, now: number): boolean {
  if (!entry) return false
  if (!entry.until) return true
  return entry.until > localDateKey(now)
}

export function putAside(map: AsideMap, card: Pick<WorkbenchCard, 'key' | 'title'>, now: number, until?: string): AsideMap {
  const valid = until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : undefined
  return { ...map, [card.key]: { at: now, title: card.title, ...(valid ? { until: valid } : {}) } }
}

export function takeBack(map: AsideMap, key: string): AsideMap {
  if (!(key in map)) return map
  const next = { ...map }
  delete next[key]
  return next
}

/** 清單上要顯示的卡片（藏起還沒到期的）。 */
export function visibleCards<T extends Pick<WorkbenchCard, 'key'>>(cards: readonly T[], map: AsideMap, now: number): T[] {
  return cards.filter(card => !isHidden(map[card.key], now))
}

/** 目前藏著的卡片（只算來源還在的，來源已處理掉的記錄不算）。 */
export function hiddenCards<T extends Pick<WorkbenchCard, 'key'>>(cards: readonly T[], map: AsideMap, now: number): T[] {
  return cards.filter(card => isHidden(map[card.key], now))
}

/** 來源已經不在（被處理掉）的記錄清掉，避免越積越多。 */
export function pruneAside(map: AsideMap, liveKeys: Iterable<string>): AsideMap {
  const live = new Set(liveKeys)
  const stale = Object.keys(map).filter(key => !live.has(key))
  if (!stale.length) return map
  const next = { ...map }
  for (const key of stale) delete next[key]
  return next
}

/** 快速選項：明天、下週一。 */
export function reminderPresets(now: number): { tomorrow: string, nextWeek: string } {
  const d = new Date(now)
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  const toMonday = ((8 - d.getDay()) % 7) || 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + toMonday)
  return { tomorrow: localDateKey(tomorrow.getTime()), nextWeek: localDateKey(monday.getTime()) }
}

export function sanitizeAside(value: unknown): AsideMap {
  if (!value || typeof value !== 'object') return {}
  const out: AsideMap = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.at !== 'number' || typeof entry.title !== 'string') continue
    out[key] = { at: entry.at, title: entry.title, ...(typeof entry.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.until) ? { until: entry.until } : {}) }
  }
  return out
}

interface Storage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<Storage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export async function loadAside(storage?: Storage): Promise<AsideMap> {
  const store = storage ?? await defaultStorage()
  return sanitizeAside(await store.get(PUT_ASIDE_KEY))
}

export async function saveAside(map: AsideMap, storage?: Storage): Promise<void> {
  const store = storage ?? await defaultStorage()
  await store.set(PUT_ASIDE_KEY, map)
  await store.save()
  // Fork（almanac ALMNC-85.4）：V3 同步開著時改由 proposals.json 的 aside: 區逐筆合併（設計 2.16），否則照舊走設定同步。
  if (!storage) notifyStoreKeyWritten(PUT_ASIDE_KEY)
}
