/**
 * Canonical inventory of V3 UI entry points rendered across main navigation,
 * Knowledge tabs, quick-add (+) menu, and the anywhere command palette.
 *
 * Kept alongside `v3-entry-inventory.test.tsx` so adding, renaming, or
 * removing an entry in source code fails the suite until the manifest is
 * intentionally updated.
 */
export const V3_ENTRY_INVENTORY = {
  mainNav: ['今天', '工作台', '對話', '整理', '計畫'],
  knowledgeTabs: ['筆記時間軸', '畫布', '標籤', '領域'],
  quickMenu: ['新增資料源', '新增對話', '新增畫布'],
  commandPalette: [
    '問 AI（隨處對話）',
    '開始新對話',
    '開啟首頁',
    '開啟資料源',
    '開啟舊記錄',
    '聚焦側欄搜尋',
    '切換左側欄',
    '切換右側欄',
    '切換亮色／深色',
    '開啟設定',
    '新增畫布',
    '開啟稍後讀清單',
  ],
} as const
