// Fork（almanac ALMNC-56.5，RPT-2026-009 V04）：Inbox 清單列的底色。
// classic 維持原本的 accent 疊色；V3 滑過用 bg-hover、選中用 bg-active，選中的列滑過時仍是選中色，
// 所以選中一定比滑過深（V3 token：hover 5%、active 9% 的 ink）。

/** 清單列共用的 hover。卡片底上用 accent：自訂深色主題裡 --muted 等於 --card。 */
export const ROW = 'transition-colors duration-100 hover:bg-accent/70'

const V3_HOVER = 'v3:hover:bg-hover'
const V3_SELECTED = 'v3:bg-active v3:hover:bg-active'

/** 一般列（Inbox 資料夾裡的筆記）：只有滑過。 */
export const PLAIN_ROW = `${ROW} ${V3_HOVER}`

/** 記錄列：勾選（selected）與展開中（focused）各自的底色。 */
export function recordRowTone(selected: boolean, focused: boolean): string {
  if (selected) return `${ROW} bg-accent/40 ${V3_SELECTED}${focused ? ' bg-hover hover:bg-active' : ''}`
  // 展開中的那筆：底色同滑過，滑過時加深到選中色（V3 用 v3: 寫死，避免和 classic 的 hover 疊色互搶）
  if (focused) return `${ROW} bg-hover hover:bg-active v3:hover:bg-active`
  return PLAIN_ROW
}
