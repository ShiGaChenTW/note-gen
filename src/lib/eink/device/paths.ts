// Fork（almanac ALMNC-52）：電子紙上可以動的路徑白名單（AC #2：只動 /plugins/almanac*/、/Books/Almanac/、
// /sleep.bmp 與新增的字型）。安裝與立即推送在發出任何請求之前，先用這裡檢查整份計畫。純函式，有單元測試。
// 路徑檢查參考 ptk862010/obsidian-xteink-sync src/device.ts 的 assertSafeDevicePath（MIT）。
import { BRIEFING_DIR, FONT_ROOT, PLUGIN_ROOT, SLEEP_DEST, UPLOAD_PART_SUFFIX } from '@/lib/eink/crosspoint'

export class DevicePathError extends Error {}

/** 絕對路徑、沒有 "." / ".." 段、沒有反斜線與控制字元。 */
export function isSafeDevicePath(path: string): boolean {
  if (!path.startsWith('/') || path.length > 255) return false
  if (/[\\\0\r\n\t]/.test(path) || /[\u0000-\u001f\u007f]/.test(path)) return false
  return path.split('/').slice(1).every(segment => segment !== '.' && segment !== '..' && segment !== '')
    || path === '/'
}

export function assertSafeDevicePath(path: string): string {
  if (!isSafeDevicePath(path)) throw new DevicePathError(`unsafe path on the reader: ${path}`)
  return path
}

const PLUGIN_DIR = /^almanac(?:-[a-z0-9]+)*$/

/** /plugins/almanac*（資料夾本身） */
export function isAlmanacPluginDir(path: string): boolean {
  const name = path.startsWith(`${PLUGIN_ROOT}/`) ? path.slice(PLUGIN_ROOT.length + 1) : ''
  return PLUGIN_DIR.test(name)
}

function parent(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

function base(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export interface AllowOptions {
  /** 這次要新增的字型檔名（只有這些可以寫進 /fonts/） */
  fontFiles?: readonly string[]
}

/** 可以寫入或刪除的檔案（含上傳中斷留下的 .part）。 */
export function isAllowedFile(path: string, options: AllowOptions = {}): boolean {
  if (!isSafeDevicePath(path)) return false
  const name = base(path)
  const plain = name.endsWith(UPLOAD_PART_SUFFIX) ? name.slice(0, -UPLOAD_PART_SUFFIX.length) : name
  if (!plain) return false
  const dir = parent(path)
  if (dir === '/' && plain === base(SLEEP_DEST)) return true
  if (isAlmanacPluginDir(dir)) return true
  if (dir === BRIEFING_DIR) return true
  if (dir === FONT_ROOT) return (options.fontFiles ?? []).includes(plain)
  return false
}

/** 可以建立的資料夾：almanac 自己的資料夾，以及它們不存在時要先建的上層（/plugins、/Books、/fonts）。 */
export function isAllowedDir(path: string): boolean {
  if (!isSafeDevicePath(path)) return false
  return path === PLUGIN_ROOT || path === '/Books' || path === BRIEFING_DIR || path === FONT_ROOT || isAlmanacPluginDir(path)
}

export function assertAllowedFile(path: string, options?: AllowOptions): string {
  if (!isAllowedFile(path, options)) throw new DevicePathError(`not allowed on the reader: ${path}`)
  return path
}

export function assertAllowedDir(path: string): string {
  if (!isAllowedDir(path)) throw new DevicePathError(`folder not allowed on the reader: ${path}`)
  return path
}

export function splitDevicePath(path: string): { dir: string, name: string } {
  return { dir: parent(path), name: base(path) }
}

/** 使用者選的字型檔名：只收英數與 ._- 空白，副檔名 .ttf／.otf。 */
export function isValidFontFileName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._ -]{0,80}\.(?:ttf|otf)$/i.test(name) && !name.includes('..')
}
