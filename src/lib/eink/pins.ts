// Fork（almanac ALMNC-45）：釘選資料清單。純函式，存在 store.json 的 einkPins。
// 每則記錄釘選日與最後送出日（後續今日簡報用來判斷「第一天放全文、之後只列標題」與每日回顧卡）。
// 路徑都是工作區相對路徑（與檔案樹、分頁同一套），筆記改名或移動時跟著改，刪除時移除。

export interface EinkPin {
  /** 工作區相對路徑，例如 「專案/電子紙.md」 */
  path: string
  /** 釘選時間（毫秒） */
  pinnedAt: number
  /** 最後一次真的送到電子紙的時間（毫秒）；還沒送過就沒有 */
  lastSentAt?: number
  /** 清單順序，0 起算、連續 */
  order: number
}

export const EINK_PINS_KEY = 'einkPins'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '')
}

/** 依 order 排好並把 order 重新編成 0..n-1。 */
function renumber(pins: readonly EinkPin[]): EinkPin[] {
  return [...pins]
    .sort((a, b) => a.order - b.order)
    .map((pin, index) => (pin.order === index ? pin : { ...pin, order: index }))
}

/** 讀回清單：丟掉壞資料與重複路徑（保留先出現的），重新編號。 */
export function normalizePins(saved: unknown): EinkPin[] {
  if (!Array.isArray(saved)) return []
  const seen = new Set<string>()
  const out: EinkPin[] = []
  saved.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return
    const value = raw as Record<string, unknown>
    if (typeof value.path !== 'string' || typeof value.pinnedAt !== 'number' || !Number.isFinite(value.pinnedAt)) return
    const path = normalizePath(value.path)
    if (!path || seen.has(path)) return
    seen.add(path)
    out.push({
      path,
      pinnedAt: value.pinnedAt,
      ...(typeof value.lastSentAt === 'number' && Number.isFinite(value.lastSentAt) ? { lastSentAt: value.lastSentAt } : {}),
      order: typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : index,
    })
  })
  return renumber(out)
}

export function isPinned(pins: readonly EinkPin[], path: string): boolean {
  const target = normalizePath(path)
  return pins.some(pin => pin.path === target)
}

/** 釘選：加在清單最後；已經釘過就不動。 */
export function addPin(pins: readonly EinkPin[], path: string, now: number): EinkPin[] {
  const target = normalizePath(path)
  if (!target || isPinned(pins, target)) return [...pins]
  return renumber([...pins, { path: target, pinnedAt: now, order: pins.length }])
}

/** 取消釘選（從清單移除）。 */
export function removePin(pins: readonly EinkPin[], path: string): EinkPin[] {
  const target = normalizePath(path)
  return renumber(pins.filter(pin => pin.path !== target))
}

export function togglePin(pins: readonly EinkPin[], path: string, now: number): EinkPin[] {
  return isPinned(pins, path) ? removePin(pins, path) : addPin(pins, path, now)
}

/** 把一則移到指定位置（拖曳放下或上下移）；位置超出範圍就夾在頭尾。 */
export function movePin(pins: readonly EinkPin[], path: string, toIndex: number): EinkPin[] {
  const ordered = renumber(pins)
  const target = normalizePath(path)
  const from = ordered.findIndex(pin => pin.path === target)
  if (from === -1) return ordered
  const to = Math.max(0, Math.min(ordered.length - 1, Math.trunc(toIndex)))
  if (from === to) return ordered
  const next = [...ordered]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map((pin, index) => (pin.order === index ? pin : { ...pin, order: index }))
}

export function movePinBy(pins: readonly EinkPin[], path: string, delta: -1 | 1): EinkPin[] {
  const ordered = renumber(pins)
  const from = ordered.findIndex(pin => pin.path === normalizePath(path))
  if (from === -1) return ordered
  return movePin(ordered, path, from + delta)
}

function isSameOrInside(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

/**
 * 檔案或資料夾改名／移動：把路徑換成新的（資料夾底下的釘選一起換）。
 * 新路徑已經有一則釘選時（例如覆蓋），保留排在前面的那則，避免重複。
 */
export function applyPathMove(pins: readonly EinkPin[], oldPath: string, newPath: string): EinkPin[] {
  const from = normalizePath(oldPath)
  const to = normalizePath(newPath)
  if (!from || !to || from === to) return [...pins]
  if (!pins.some(pin => isSameOrInside(pin.path, from))) return [...pins]
  const moved = renumber(pins).map(pin => (
    isSameOrInside(pin.path, from) ? { ...pin, path: `${to}${pin.path.slice(from.length)}` } : pin
  ))
  const seen = new Set<string>()
  return renumber(moved.filter(pin => {
    if (seen.has(pin.path)) return false
    seen.add(pin.path)
    return true
  }))
}

/** 檔案或資料夾刪除：移除對應的釘選（資料夾連同底下全部）。 */
export function applyPathDelete(pins: readonly EinkPin[], path: string, isFolder: boolean): EinkPin[] {
  const target = normalizePath(path)
  if (!target) return [...pins]
  const remaining = pins.filter(pin => (isFolder ? !isSameOrInside(pin.path, target) : pin.path !== target))
  return remaining.length === pins.length ? [...pins] : renumber(remaining)
}

/** 真的送到電子紙後（區網下載成功或立即推送）記下最後送出日。 */
export function markPinsSent(pins: readonly EinkPin[], paths: readonly string[], at: number): EinkPin[] {
  const sent = new Set(paths.map(normalizePath))
  return pins.map(pin => (sent.has(pin.path) ? { ...pin, lastSentAt: at } : pin))
}
