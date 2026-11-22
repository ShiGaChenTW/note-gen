// Fork（almanac ALMNC-52）：跟電子紙說話用的 HTTP。app 內走 Tauri http plugin；測試可以換掉（並檢查有沒有發請求）。
import { tauriHttp, type HttpFn } from './client'

let override: HttpFn | null = null

/** 測試用：換掉 HTTP；傳 null 回到 Tauri。 */
export function configureDeviceHttp(http: HttpFn | null): void {
  override = http
}

export function deviceHttp(): HttpFn {
  return override ?? tauriHttp
}
