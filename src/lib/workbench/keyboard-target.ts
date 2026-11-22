// Fork（almanac ALMNC-56.1，RPT-2026-009 A01）：工作台的單鍵操作在 window 的 capture 階段處理，
// 焦點落在按鈕、連結、頁籤、選單這類自己會處理按鍵的元件上時，該讓給那個元件：
//   - 選單、下拉清單、樹狀、滑桿這類複合元件：所有按鍵都歸它（方向鍵在選單內移動、字母跳到該項）。
//   - 按鈕、連結、頁籤、核取方塊等單一控制項：Enter、空白鍵與方向鍵歸它，其餘單鍵照常給工作台。
//   - 工作台自己的清單項目（data-workbench-item，或工作台清單裡的 option）不算：焦點在清單上時單鍵操作照舊。

/** 所有按鍵都歸這些元件。工作台自己的清單（data-workbench-list）除外。 */
const COMPOSITE_SELECTOR = [
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]:not([data-workbench-list])',
  '[role="combobox"]',
  '[role="tree"]',
  '[role="treegrid"]',
  '[role="grid"]',
  '[role="radiogroup"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(', ')

/** 會自己處理 Enter、空白鍵或方向鍵的單一控制項。 */
const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="treeitem"]',
  '[role="separator"][tabindex]',
].join(', ')

/** 工作台清單上的一項：焦點在這裡時，單鍵操作照舊由工作台處理。 */
const LIST_ITEM_SELECTOR = '[data-workbench-item], [data-workbench-list] [role="option"]'

const CONTROL_KEYS = new Set(['enter', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end'])

function elementOf(target: EventTarget | null): Element | null {
  if (typeof Element === 'undefined') return null
  if (target instanceof Element) return target
  return typeof Node !== 'undefined' && target instanceof Node ? target.parentElement : null
}

/**
 * 這個按鍵是不是該留給焦點所在的元件（工作台與全域單鍵就不處理）。
 * key 是 KeyboardEvent.key（大小寫不拘）。target 不是元素（window、document）時回傳 false：焦點在頁面本身。
 */
export function keyBelongsToTarget(target: EventTarget | null, key: string): boolean {
  const element = elementOf(target)
  if (!element) return false
  if (element.closest(COMPOSITE_SELECTOR)) return true
  const control = element.closest(CONTROL_SELECTOR)
  if (!control || control.matches(LIST_ITEM_SELECTOR)) return false
  return CONTROL_KEYS.has(key.toLowerCase())
}
