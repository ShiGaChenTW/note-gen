// Fork（almanac ALMNC-56.6，RPT-2026-009 V06）：V3 按鈕統一的高度與圓角。
// 對話、收集、工作台的主要按鈕原本有 28、30、32 px 三種高度；一律用這組。
// 數值依報告 §04 的示意（32 px）與圓角 --r（6 px），Scott 尚未拍板——要改高度或圓角只改這一行。
export const V3_BUTTON_SHAPE = 'h-8 rounded-(--r)'

/**
 * 按鈕裡的鍵盤提示（共用的 components/ui/kbd.tsx）：底色與字色跟著按鈕走，
 * 主要按鈕（反白）上也看得清楚。
 */
export const KBD_ON_BUTTON = 'text-current v3:bg-current/15'
