// Fork（almanac）：V3 編輯區右上角筆記工具列的「置頂」與「收藏」——純函式。
// 兩者都是「每個工作區一份筆記路徑清單」。路徑一律用 vault 相對路徑（與 activeFilePath、vault 索引相同），
// 比對前把反斜線換成斜線、去掉頭尾斜線。新標記的放最前面（清單本身沒有排序意義，只是好讀）。

/** 比對用的路徑：反斜線換成斜線，去掉頭尾斜線。 */
export function normalizeNotePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** 標記清單依工作區分開存；預設工作區（設定裡 workspacePath 為空字串）用固定鍵。 */
export function noteMarksWorkspaceKey(workspacePath: string): string {
  const normalized = workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized || '__default__'
}

export function hasMarkedPath(list: readonly string[], path: string): boolean {
  const target = normalizeNotePath(path)
  return Boolean(target) && list.some(item => normalizeNotePath(item) === target)
}

/** 有就拿掉，沒有就加到最前面。空路徑原樣回傳。 */
export function toggleMarkedPath(list: readonly string[], path: string): string[] {
  const target = normalizeNotePath(path)
  if (!target) return [...list]
  return hasMarkedPath(list, target)
    ? list.filter(item => normalizeNotePath(item) !== target)
    : [target, ...list]
}

/**
 * 筆記或資料夾改名／搬移後跟著改路徑。oldPath 是資料夾時，底下的筆記一起換前綴。
 * 換完若和既有項目重複，只留一個。
 */
export function moveMarkedPaths(list: readonly string[], oldPath: string, newPath: string): string[] {
  const from = normalizeNotePath(oldPath)
  const to = normalizeNotePath(newPath)
  if (!from || !to || from === to) return [...list]
  const moved = list.map(item => {
    const path = normalizeNotePath(item)
    if (path === from) return to
    if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
    return path
  })
  return [...new Set(moved)]
}

/** 筆記刪除後拿掉；isFolder 時連資料夾底下的筆記一起拿掉。 */
export function removeMarkedPaths(list: readonly string[], path: string, isFolder: boolean): string[] {
  const target = normalizeNotePath(path)
  if (!target) return [...list]
  return list.filter(item => {
    const current = normalizeNotePath(item)
    return current !== target && !(isFolder && current.startsWith(`${target}/`))
  })
}

/** 置頂的排在最前面；置頂與非置頂各自維持原本的順序（穩定排序）。 */
export function sortPinnedFirst<T extends { path: string }>(items: readonly T[], pinned: readonly string[]): T[] {
  if (pinned.length === 0) return [...items]
  const set = new Set(pinned.map(normalizeNotePath))
  const top: T[] = []
  const rest: T[] = []
  for (const item of items) (set.has(normalizeNotePath(item.path)) ? top : rest).push(item)
  return [...top, ...rest]
}
