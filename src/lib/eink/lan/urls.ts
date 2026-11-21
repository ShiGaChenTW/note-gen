// Fork（almanac ALMNC-50）：區網服務的網址（設定頁顯示、ALMNC-51 外掛設定檔、ALMNC-52 安裝都用這裡）。
// 路徑要和 src-tauri/src/eink_lan.rs 的路由白名單一致。純函式，有單元測試。

export const LAN_SLEEP_PATH = '/eink/sleep.bmp'
export const LAN_EPUB_PATH = '/eink/today.epub'
export const LAN_OPDS_PATH = '/opds'
/** OPDS 的 HTTP Basic 帳號；密碼是 token。 */
export const LAN_OPDS_USER = 'almanac'

/** 伺服器網址，例如 http://192.168.1.5:37424（address 是 Rust 回報的「IP:埠」）。 */
export function lanServerBase(address: string): string {
  return `http://${address.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`
}

/** 外掛用的休眠畫面網址（token 放網址參數；外掛同時也帶 Bearer 標頭）。 */
export function lanSleepUrl(base: string, token: string): string {
  return `${base}${LAN_SLEEP_PATH}?token=${encodeURIComponent(token)}`
}

export function lanEpubUrl(base: string, token: string): string {
  return `${base}${LAN_EPUB_PATH}?token=${encodeURIComponent(token)}`
}

export function lanOpdsUrl(base: string): string {
  return `${base}${LAN_OPDS_PATH}`
}

/** 設定頁顯示用：token 換成遮罩。 */
export function redactToken(url: string, token: string): string {
  return token ? url.split(encodeURIComponent(token)).join(`${'•'.repeat(8)}${token.slice(-4)}`) : url
}

/** 本地時間的隔天零點（毫秒）：過了這個時間，今天產生的內容就不再送出。 */
export function nextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return next.getTime()
}
