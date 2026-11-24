// Spike（almanac ALMNC-77）：新舊輸入框切換旗標。只在桌面版生效；開啟方式：
//   在開發者工具 Console 執行 localStorage.setItem('almanac.experimental.tiptapComposer', 'true')，再重新整理。
//   關閉：localStorage.removeItem('almanac.experimental.tiptapComposer')。
export const TIPTAP_COMPOSER_FLAG = 'almanac.experimental.tiptapComposer'
