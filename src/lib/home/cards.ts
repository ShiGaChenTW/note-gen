// Fork（#31）：首頁卡片的開關與排序。純函式，存在 store.json 的 homeCards。
// 術語見 GLOSSARY.md「首頁卡片」；版面見 personal/specs/11 §2.1a（版型 D）。

/** 卡片放進版型 D 的哪些位置：頂部列、頂部指令區、主欄、右欄。 */
export type HomeSlot = 'header' | 'top' | 'main' | 'side'

export interface HomeCardMeta {
  key: string
  defaultOn: boolean
}

export interface HomeCardPrefs {
  /** 卡片順序；同一欄內依此排列。 */
  order: string[]
  /** 使用者關掉的卡片。 */
  hidden: string[]
  /** 使用者打開過的預設關閉卡片（之後新增的預設關閉卡片不會被誤開）。 */
  shown: string[]
}

export const EMPTY_PREFS: HomeCardPrefs = { order: [], hidden: [], shown: [] }

function uniqueKnown(keys: unknown, known: Set<string>): string[] {
  if (!Array.isArray(keys)) return []
  return [...new Set(keys.filter((key): key is string => typeof key === 'string' && known.has(key)))]
}

/** 讀回設定：丟掉已不存在的卡片，新加入的卡片依登記順序補在最後。 */
export function normalizePrefs(saved: unknown, cards: HomeCardMeta[]): HomeCardPrefs {
  const known = new Set(cards.map(card => card.key))
  const value = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof HomeCardPrefs, unknown>>
  const order = uniqueKnown(value.order, known)
  for (const card of cards) if (!order.includes(card.key)) order.push(card.key)
  return { order, hidden: uniqueKnown(value.hidden, known), shown: uniqueKnown(value.shown, known) }
}

export function isCardVisible(prefs: HomeCardPrefs, card: HomeCardMeta): boolean {
  if (prefs.hidden.includes(card.key)) return false
  return card.defaultOn || prefs.shown.includes(card.key)
}

export function setCardVisible(prefs: HomeCardPrefs, card: HomeCardMeta, visible: boolean): HomeCardPrefs {
  const hidden = prefs.hidden.filter(key => key !== card.key)
  const shown = prefs.shown.filter(key => key !== card.key)
  if (!visible) hidden.push(card.key)
  else if (!card.defaultOn) shown.push(card.key)
  return { ...prefs, hidden, shown }
}

/** 把 key 移到 target 的位置（拖曳放下）；target 不存在就不動。 */
export function moveCardTo(prefs: HomeCardPrefs, key: string, target: string): HomeCardPrefs {
  if (key === target) return prefs
  const from = prefs.order.indexOf(key)
  const to = prefs.order.indexOf(target)
  if (from === -1 || to === -1) return prefs
  const order = [...prefs.order]
  order.splice(from, 1)
  order.splice(to, 0, key)
  return { ...prefs, order }
}

/** 上移／下移一格（鍵盤與按鈕用）。 */
export function moveCardBy(prefs: HomeCardPrefs, key: string, delta: -1 | 1): HomeCardPrefs {
  const from = prefs.order.indexOf(key)
  const to = from + delta
  if (from === -1 || to < 0 || to >= prefs.order.length) return prefs
  return moveCardTo(prefs, key, prefs.order[to])
}

/** 依目前設定排出某一欄要顯示的卡片。 */
export function cardsForSlot<T extends HomeCardMeta & { slots: Partial<Record<HomeSlot, unknown>> }>(
  cards: T[],
  prefs: HomeCardPrefs,
  slot: HomeSlot,
): T[] {
  const byKey = new Map(cards.map(card => [card.key, card]))
  return prefs.order
    .map(key => byKey.get(key))
    .filter((card): card is T => Boolean(card && card.slots[slot] && isCardVisible(prefs, card)))
}
