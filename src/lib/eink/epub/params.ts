// Fork（almanac ALMNC-48）：今日簡報 EPUB 的硬體相關參數。
// 實機驗證（ALMNC-44：X4 Pro＋CrossPoint 2.x）還沒做，這裡的值都是計畫 v2 的假設；
// 驗證後只改這個檔案，產生器的邏輯不用動。每個值旁邊寫明依據與「待驗證」的點。

/**
 * 檔案大小上限（bytes）。CrossPoint 外掛下載單檔上限 1 MB（docs/plugin-events.md）。
 * 待 ALMNC-44 確認是 1,000,000 還是 1,048,576；先取較小的 1,000,000，兩種解讀都不會超過。
 */
export const EPUB_MAX_BYTES = 1_000_000

/**
 * 一「頁」的字數預算（AC #3「正文超過 5 頁」的頁）。
 * 依據：X4 Pro 480×800，扣掉邊界約 440×720 可用；CrossPoint 預設字級約 20px、行高 1.4
 * → 每行約 22 個中文字、每頁約 25 行 ≈ 550 字，再扣段落間距取 500。
 * 計算方式見 pages.ts：中日韓字元算 1，其他非空白字元算 0.5（英文字母約半個中文字寬），空白不算。
 * 待 ALMNC-44 用實機的預設字型與字級量一頁實際放幾個字後調整。
 */
export const CHARS_PER_PAGE = 500

/** 一張圖算幾頁（480 寬的圖在 800 高的畫面上大約佔半頁）。 */
export const IMAGE_PAGE_COST = 0.5

/** 每日精選文章正文最多幾頁，超過的截在段落邊界、其餘放附錄（計畫 v2）。 */
export const ARTICLE_MAX_PAGES = 5

/** 圖片縮到的最大寬度（px）：X4 Pro 螢幕寬 480。 */
export const EPUB_IMAGE_MAX_WIDTH = 480

/** 圖片最大高度（px）：太長的圖等比縮小，免得閱讀器解碼一張超長圖吃光記憶體（ESP32-S3）。待 ALMNC-44 確認。 */
export const EPUB_IMAGE_MAX_HEIGHT = 1600

/** JPEG 品質（0–1）。灰階、4 階顯示的螢幕不需要高品質；0.7 是大小與清晰的折衷。 */
export const EPUB_JPEG_QUALITY = 0.7

/** 每章最多放幾張圖（避免一篇圖很多的文章吃掉大部分的 1 MB）。 */
export const EPUB_MAX_IMAGES_PER_ARTICLE = 8
