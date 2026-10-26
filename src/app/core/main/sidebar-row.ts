// Fork（#44 後續）：左側欄裡可點的列共用的樣式，對齊檔案樹的 .file-manager-item（globals.css）。
// 一律用 sidebar 色票：自訂深色主題裡 --muted 等於 --card，hover:bg-muted 在側欄與卡片上幾乎看不出來。
export const SIDEBAR_ROW = 'cursor-pointer rounded-md outline-none transition-colors duration-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring/65'

export const SIDEBAR_ROW_ACTIVE = 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
