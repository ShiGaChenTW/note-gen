// Fork（#44 後續；almanac P0-c 改 v5）：左側欄裡可點的列共用的樣式。
// v5：圓角 6px、hover bg-hover、選中 bg-active，全用 ink 疊透明的 token，亮暗自動切換。
// ALMNC-56.6（V09、V14）：classic 的檔案樹也用這組，所以 V3 的圓角（ALMNC-79.3 起 --r-row）與選中字重（500）用 v3: 覆寫，classic 不變。
export const SIDEBAR_ROW = 'cursor-pointer rounded-md v3:rounded-(--r-row) outline-none transition-colors duration-100 ease-out hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/60'

export const SIDEBAR_ROW_ACTIVE = 'bg-active font-[560] text-ink v3:font-medium'

/** 次要選中：首頁或 Inbox 頁開著時，下半部顯示中的入口只用字色標示，不加底色。 */
export const SIDEBAR_ROW_ACTIVE_SECONDARY = 'font-[560] text-ink v3:font-medium'

/**
 * Fork（almanac ALMNC-79.2）：V3 的選中列改成「浮起」（淡漸層底、細框、淡陰影），側欄、清單、週列日期共用。
 * 接在原本的選中樣式後面：classic 維持 bg-active，V3 換成浮起。浮層裡的選單（⌘K、斜線選單、篩選）不要用。
 */
export const SELECTED_RAISED = 'v3:selected-raised'
