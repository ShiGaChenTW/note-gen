// Fork（almanac ALMNC-97.1）：V3 文件切換的「最近使用順序」。
// 三種切換樣式（A 上方疊列、B 資料夾標籤、C 斜向錯開）共用同一份順序：
// 最近使用的排前面；固定的分頁排最左、照原本順序，不參與排序。
// 這裡只放純函式，狀態在 stores/doc-switcher.ts。

export interface RecencyTab {
  id: string
  pinned?: boolean
}

/** 同時掛載（保留在記憶體）的分頁上限。超過的分頁保留在列上，但內容先卸載，再點時重新讀檔。 */
export const MOUNTED_TAB_LIMIT = 8

/** 把 id 移到最前面。 */
export function touchRecency(recency: readonly string[], id: string): string[] {
  if (!id) return [...recency]
  if (recency[0] === id) return [...recency]
  return [id, ...recency.filter(item => item !== id)]
}

/**
 * 讓順序跟目前開著的分頁一致：拿掉已關閉的，沒記錄過的接在最後（當成最久沒看），
 * 目前這張移到最前面。內容沒變時回傳同一個陣列。
 */
export function reconcileRecency(
  recency: readonly string[],
  tabIds: readonly string[],
  activeId?: string,
): readonly string[] {
  const open = new Set(tabIds)
  const kept = recency.filter(id => open.has(id))
  const known = new Set(kept)
  const next = [...kept, ...tabIds.filter(id => !known.has(id))]
  const ordered = activeId && open.has(activeId) ? touchRecency(next, activeId) : next
  const unchanged = ordered.length === recency.length && ordered.every((id, index) => id === recency[index])
  return unchanged ? recency : ordered
}

function rankOf(recency: readonly string[]) {
  const rank = new Map(recency.map((id, index) => [id, index]))
  return (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER
}

/** 顯示順序：固定的分頁照原本順序排最左，其餘依最近使用排序（沒記錄的排最後，維持原本相對順序）。 */
export function orderTabsByRecency<T extends RecencyTab>(tabs: readonly T[], recency: readonly string[]): T[] {
  const rank = rankOf(recency)
  const pinned = tabs.filter(tab => tab.pinned)
  const rest = tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ tab }) => !tab.pinned)
    .sort((a, b) => rank(a.tab.id) - rank(b.tab.id) || a.index - b.index)
    .map(({ tab }) => tab)
  return [...pinned, ...rest]
}

/**
 * 要掛載的分頁：目前這張與固定的分頁一定掛載，其餘依最近使用補到上限。
 * 固定的分頁超過上限時仍全部掛載（使用者明確要留著的）。
 */
export function pickMountedTabIds(
  tabs: readonly RecencyTab[],
  recency: readonly string[],
  activeId: string | undefined,
  limit = MOUNTED_TAB_LIMIT,
): Set<string> {
  const mounted = new Set<string>()
  const ids = new Set(tabs.map(tab => tab.id))
  if (activeId && ids.has(activeId)) mounted.add(activeId)
  for (const tab of tabs) if (tab.pinned) mounted.add(tab.id)
  const rank = rankOf(recency)
  const rest = tabs
    .filter(tab => !mounted.has(tab.id))
    .sort((a, b) => rank(a.id) - rank(b.id))
  for (const tab of rest) {
    if (mounted.size >= limit) break
    mounted.add(tab.id)
  }
  return mounted
}

/** 關掉 closedId 之後要切到哪一張：剩下的分頁裡最近使用的那張；都沒記錄就用剩下的第一張。 */
export function pickFallbackAfterClose(
  recency: readonly string[],
  closedId: string,
  remainingIds: readonly string[],
): string | undefined {
  const remaining = new Set(remainingIds)
  return recency.find(id => id !== closedId && remaining.has(id)) ?? remainingIds.find(id => id !== closedId)
}

/** 樣式 B 的標籤尺寸（px）：每張寬度、彼此重疊、列的左右留白、「更多」按鈕寬度。 */
export const FOLDER_TAB = { width: 150, overlap: 8, padding: 20, more: 76 } as const

/** 標籤列寬度放得下幾張標籤（至少 1 張）。全部放得下就不留「更多」的位置。 */
export function folderTabCapacity(rowWidth: number, total: number): number {
  const step = FOLDER_TAB.width - FOLDER_TAB.overlap
  const usable = rowWidth - FOLDER_TAB.padding + FOLDER_TAB.overlap
  if (total * step <= usable) return total
  return Math.max(1, Math.floor((usable - FOLDER_TAB.more) / step))
}

/**
 * 依容量分成看得到的標籤與收進「更多」的標籤（ordered 已經是顯示順序）。
 * 目前這張一定看得到：被擠出去時（例如固定的分頁太多）換掉最後一張看得到的。
 */
export function splitVisibleTabs<T extends RecencyTab>(
  ordered: readonly T[],
  activeId: string | undefined,
  capacity: number,
): { visible: T[], hidden: T[] } {
  if (ordered.length <= capacity) return { visible: [...ordered], hidden: [] }
  const visible = ordered.slice(0, capacity)
  if (activeId && !visible.some(tab => tab.id === activeId)) {
    const active = ordered.find(tab => tab.id === activeId)
    if (active) visible[visible.length - 1] = active
  }
  const shown = new Set(visible.map(tab => tab.id))
  return { visible, hidden: ordered.filter(tab => !shown.has(tab.id)) }
}

/** 樣式 A、C 展開時最多顯示幾張後面的卡（加上前面那張共 5 張）。 */
export const STACK_BACK_LIMIT = 4

/** 樣式 A、C：目前這張以外，依顯示順序取前幾張當後面的卡（第 1 張在最靠近前面那張的位置），其餘收進「更多」。 */
export function splitStackTabs<T extends RecencyTab>(
  ordered: readonly T[],
  activeId: string | undefined,
  limit = STACK_BACK_LIMIT,
): { back: T[], hidden: T[] } {
  const others = ordered.filter(tab => tab.id !== activeId)
  return { back: others.slice(0, limit), hidden: others.slice(limit) }
}
