// Fork（almanac ALMNC-49）：休眠畫面的硬體與版面參數。
// BMP 格式已由實機確認（ALMNC-44／58）；版面數值是計畫 v2 的設定。

/** 畫面尺寸：X4 Pro 直式 480×800（CrossPoint 休眠圖的原生尺寸）。 */
export const SLEEP_WIDTH = 480
export const SLEEP_HEIGHT = 800

/**
 * BMP 格式：8-bit 灰階（256 色調色盤），480×800 約 385 KB，在外掛 1 MB 下載上限內。
 * 實機（ALMNC-44／58，X4 Pro＋CrossPoint 2.0.6）：2-bit（4 階灰，約 94 KB）太粗；
 * 24-bit（約 1.15 MB）細緻但超過 1 MB，外掛那次休眠的下載全部失敗；8-bit 細緻度與 24-bit 相同。
 */
export const SLEEP_BMP_BIT_DEPTH = 8
export const SLEEP_BMP_PALETTE_SIZE = 256

/**
 * 設計稿的 4 個顏色：0 黑、1 深灰、2 淺灰、3 白（設計稿 H 版：#000 #555 #AAA #FFF）。
 * 排版指令用這個索引；畫到 canvas 後保留反鋸齒的中間灰，整張圖以 0–255 灰階存進 BMP，不再量化成 4 階。
 */
export const GRAY_LEVELS = [0x00, 0x55, 0xAA, 0xFF] as const
export type GrayLevel = 0 | 1 | 2 | 3

/** 行程最多列幾件（不含全天行程）；超過的顯示「另有 N 件 · 見簡報第 1 章」（計畫 v2）。 */
export const SLEEP_MAX_EVENTS = 8

/**
 * 字型策略：休眠畫面是在 Tauri webview 的 canvas 上畫好再轉成 BMP，閱讀器只顯示點陣圖，
 * 所以字型只要 Mac 上有就好，不用裝到閱讀器上。中文用系統字型堆疊（macOS 的 PingFang TC 優先），
 * 數字與時間用等寬字（時間欄才會對齊）。canvas 的 fillText 一律帶 maxWidth，量錯也不會超出版面。
 */
export const FONT_STACKS = {
  sans: '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Heiti TC", "Microsoft JhengHei", sans-serif',
  mono: '"SF Mono", Menlo, "IBM Plex Mono", Consolas, monospace',
} as const

/**
 * 排版時估字寬（不依賴實際字型，版面在測試與 app 內完全相同，快照測試才有意義）：
 * 中日韓與全形字 1em；等寬字 0.6em（SF Mono、Menlo 的實際寬度）；其他比例字取偏寬的 0.6em。
 */
export const CHAR_WIDTH_EM = { wide: 1, mono: 0.6, narrow: 0.6 } as const

/** 版面尺寸（px），照設計稿 H 版：細膩、精準技術感、資訊密集、靠左對齊。 */
export const LAYOUT = {
  marginX: 20,
  marginTop: 18,
  marginBottom: 14,
  stripSize: 13,
  dateSize: 30,
  metaSize: 13,
  sectionSize: 13,
  weatherTempSize: 24,
  eventTimeSize: 15,
  eventTitleSize: 15,
  eventMetaSize: 13,
  timeColumn: 46,
  dotColumn: 18,
  columnGap: 8,
  rowPadding: 12,
  titleLineHeight: 20,
  metaLineHeight: 18,
  cardTitleSize: 17,
  cardBodySize: 15,
  cardLineHeight: 22,
  footerSize: 13,
} as const
