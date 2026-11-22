// Fork（almanac）：V3 編輯區右上角工具列要顯示哪些按鈕——純函式。
// 四組：[上一篇 下一篇] | [尋找 標籤 置頂 收藏] | [大綱 版本歷史 筆記資訊 命令面板] | [復原 重做]。
// - 記錄、空白頁、外掛、瀏覽器分頁不顯示工具列（沿用原本復原／重做的規則）。
// - 筆記專屬的按鈕（尋找到筆記資訊）只給 Markdown 筆記（.md）；畫布、圖片、資料夾等只留導覽、命令面板與復原／重做。
// - 編輯區窄於 COMPACT_TOOLBAR_WIDTH 時，第三、四組收進「⋯」選單，避免整條壓到標題。

export const COMPACT_TOOLBAR_WIDTH = 720

export type NoteToolbarScope = 'hidden' | 'basic' | 'note'

export interface NoteToolbarTab {
  path: string
  isFolder?: boolean
  kind?: 'file' | 'record' | 'canvas' | 'blank' | 'plugin' | 'browser'
}

const HIDDEN_KINDS = new Set<NoteToolbarTab['kind']>(['record', 'blank', 'plugin', 'browser'])

export function noteToolbarScope(tab: NoteToolbarTab | undefined, isActiveGroup: boolean): NoteToolbarScope {
  if (!isActiveGroup || !tab) return 'hidden'
  if (HIDDEN_KINDS.has(tab.kind)) return 'hidden'
  if (tab.kind === 'canvas' || tab.isFolder) return 'basic'
  return /\.md$/i.test(tab.path) ? 'note' : 'basic'
}

/** 寬度還沒量到（0）時先當成寬版，避免一打開就閃一下選單。 */
export function isCompactToolbar(width: number): boolean {
  return width > 0 && width < COMPACT_TOOLBAR_WIDTH
}
