// Fork（almanac ALMNC-50）：前端和 Rust 區網服務（src-tauri/src/eink_lan.rs）之間的指令與事件。
// invoke／listen 可注入（測試用）。token 只傳給 Rust 比對，不印出來。

export type LanAssetKind = 'sleep' | 'epub'

export interface LanAssetView {
  date: string
  size: number
  publishedAt: number
}

export interface EinkLanStatus {
  running: boolean
  /** 實際綁定的「IP:埠」 */
  address: string | null
  /** 現在偵測到的區網 IP；和 address 不同時要重新套用 */
  lanIp: string | null
  error: string | null
  sleep: LanAssetView | null
  epub: LanAssetView | null
  archived: string[]
}

export interface LanPublishInput {
  kind: LanAssetKind
  date: string
  hash: string
  title: string
  validUntil: number
  bytes: Uint8Array
}

export const LAN_EVENT_REFRESH = 'eink-lan-refresh'
export const LAN_EVENT_DOWNLOADED = 'eink-lan-downloaded'

export interface LanRefreshEvent { kind: LanAssetKind }
export interface LanDownloadedEvent { kind: LanAssetKind, date: string, hash: string }

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

/** Uint8Array → base64（分段，避免大檔撐爆呼叫堆疊）。 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function configureLan(enabled: boolean, port: number, token: string, invoke: Invoke = tauriInvoke): Promise<EinkLanStatus> {
  return invoke<EinkLanStatus>('eink_lan_configure', { enabled, port, token: enabled ? token : '' })
}

export function lanStatus(invoke: Invoke = tauriInvoke): Promise<EinkLanStatus> {
  return invoke<EinkLanStatus>('eink_lan_status')
}

export function publishLan(input: LanPublishInput, invoke: Invoke = tauriInvoke): Promise<void> {
  return invoke<void>('eink_lan_publish', {
    kind: input.kind, date: input.date, hash: input.hash, title: input.title, validUntil: input.validUntil, bytes: toBase64(input.bytes),
  })
}

/** SHA-256 十六進位（快取鍵與「哪一份被下載了」的對照）。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
