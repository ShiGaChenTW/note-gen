// Fork（almanac ALMNC-52）：CrossPoint File Transfer 模式的用戶端（HTTP 可注入，測試不連網路）。
// 端點與格式見 src/lib/eink/crosspoint.ts；寫法參考 ptk862010/obsidian-xteink-sync src/device.ts（MIT，commit 58e09e8）。
// 每個會寫入或刪除的方法都先檢查白名單（paths.ts），不在白名單的路徑直接丟錯、不發請求。
import { DEVICE_API, MAX_OPDS_SERVERS, OPDS_ENTRY_NAME, UPLOAD_PART_SUFFIX } from '@/lib/eink/crosspoint'
import { assertAllowedDir, assertAllowedFile, assertSafeDevicePath, splitDevicePath, type AllowOptions } from './paths'

export interface HttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string | Uint8Array
}

export interface HttpResponse {
  status: number
  text: string
}

export type HttpFn = (request: HttpRequest) => Promise<HttpResponse>

export interface DeviceStatus {
  version: string
  firmwareFamily?: string
  ip?: string
  mode?: string
  device?: string
}

export interface DeviceEntry {
  name: string
  size: number
  isDirectory: boolean
  isEpub?: boolean
}

export interface DeviceOpdsServer {
  index: number
  name: string
  url: string
  username: string
  hasPassword: boolean
}

export interface OpdsInput {
  name: string
  url: string
  username: string
  password: string
}

export class DeviceError extends Error {}

/** app 內：用 Tauri http plugin（不受 webview CORS 限制）。 */
export const tauriHttp: HttpFn = async request => {
  const { fetch } = await import('@tauri-apps/plugin-http')
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body instanceof Uint8Array ? request.body.slice().buffer : request.body,
  })
  return { status: response.status, text: await response.text() }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeviceError(`${what}: timed out after ${Math.round(ms / 1000)}s`)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error instanceof Error ? error : new DeviceError(String(error))) },
    )
  })
}

export function formUrlEncoded(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
}

/** multipart/form-data，單一檔案欄位 file。 */
export function buildMultipart(fileName: string, bytes: Uint8Array, contentType: string, boundary = `----almanac${Math.random().toString(16).slice(2)}`): { body: Uint8Array, contentType: string } {
  const safeName = fileName.replace(/["\r\n]/g, '_')
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  )
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head, 0)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

/** 比對 OPDS 網址：忽略結尾斜線與主機大小寫（obsidian-xteink-sync 的 sameOpdsUrl）。 */
export function sameOpdsUrl(a: string, b: string): boolean {
  const norm = (value: string) => {
    try {
      const url = new URL(value.trim())
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
    } catch {
      return value.trim().replace(/\/+$/, '')
    }
  }
  return norm(a) === norm(b)
}

export class CrossPointClient {
  constructor(
    private readonly http: HttpFn,
    /** 例如 http://192.168.1.20（設定頁的閱讀器位址，已正規化） */
    public readonly base: string,
    private readonly allow: AllowOptions = {},
    private readonly timeoutMs = 5000,
    private readonly uploadTimeoutMs = 5 * 60_000,
  ) {}

  private url(path: string): string {
    return `${this.base.replace(/\/+$/, '')}${path}`
  }

  async status(): Promise<DeviceStatus> {
    const response = await withTimeout(this.http({ url: this.url(DEVICE_API.status), method: 'GET' }), this.timeoutMs, 'status')
    if (response.status !== 200) throw new DeviceError(`${DEVICE_API.status}: ${response.status}`)
    const status = JSON.parse(response.text) as DeviceStatus
    if (!status || typeof status.version !== 'string') throw new DeviceError('not a CrossPoint reader')
    return status
  }

  async listFiles(dir: string): Promise<DeviceEntry[]> {
    const response = await withTimeout(
      this.http({ url: this.url(`${DEVICE_API.files}?path=${encodeURIComponent(assertSafeDevicePath(dir))}`), method: 'GET' }),
      this.timeoutMs, 'list',
    )
    if (response.status === 404) return []
    if (response.status !== 200) throw new DeviceError(`${DEVICE_API.files}: ${response.status}`)
    const entries = JSON.parse(response.text) as DeviceEntry[]
    return Array.isArray(entries) ? entries : []
  }

  /** 建資料夾（已經有就不動）；只建白名單裡的資料夾，上層不存在時一層一層建。 */
  async ensureDir(dir: string): Promise<void> {
    assertAllowedDir(dir)
    const segments = dir.split('/').filter(Boolean)
    let current = ''
    for (const segment of segments) {
      const parentDir = current || '/'
      current = `${current}/${segment}`
      const entries = await this.listFiles(parentDir)
      if (entries.some(entry => entry.isDirectory && entry.name === segment)) continue
      assertAllowedDir(current)
      const response = await withTimeout(this.http({
        url: this.url(DEVICE_API.mkdir),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formUrlEncoded({ name: segment, path: parentDir }),
      }), this.timeoutMs, 'mkdir')
      if (response.status !== 200) throw new DeviceError(`${DEVICE_API.mkdir} ${current}: ${response.status}`)
    }
  }

  async delete(path: string): Promise<void> {
    assertAllowedFile(path, this.allow)
    const response = await withTimeout(this.http({
      url: this.url(DEVICE_API.delete),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formUrlEncoded({ path }),
    }), this.timeoutMs, 'delete')
    if (response.status !== 200) throw new DeviceError(`${DEVICE_API.delete} ${path}: ${response.status}`)
  }

  /**
   * 上傳並確認：用 overwrite=1（韌體先寫 <name>.part，完整收到才換掉舊檔，所以斷線不會留下半個檔），
   * 上傳後再列一次資料夾核對大小；大小不對就刪掉這個檔。上傳失敗時順手清掉留下的 .part。
   */
  async uploadVerified(path: string, bytes: Uint8Array, contentType = 'application/octet-stream'): Promise<void> {
    assertAllowedFile(path, this.allow)
    const { dir, name } = splitDevicePath(path)
    const { body, contentType: multipartType } = buildMultipart(name, bytes, contentType)
    try {
      const response = await withTimeout(this.http({
        url: this.url(`${DEVICE_API.upload}?path=${encodeURIComponent(dir)}&overwrite=1`),
        method: 'POST',
        headers: { 'Content-Type': multipartType },
        body,
      }), this.uploadTimeoutMs, `upload ${name}`)
      if (response.status !== 200) throw new DeviceError(`upload ${path}: ${response.status} ${response.text.slice(0, 120)}`)
    } catch (error) {
      await this.cleanupPart(dir, name)
      throw error
    }
    const entry = (await this.listFiles(dir)).find(item => !item.isDirectory && item.name === name)
    if (!entry || entry.size !== bytes.length) {
      if (entry) await this.delete(path).catch(() => {})
      throw new DeviceError(`upload ${path}: size mismatch (${entry?.size ?? 'missing'} != ${bytes.length})`)
    }
  }

  private async cleanupPart(dir: string, name: string): Promise<void> {
    try {
      const part = `${name}${UPLOAD_PART_SUFFIX}`
      const entries = await this.listFiles(dir)
      if (entries.some(entry => !entry.isDirectory && entry.name === part)) await this.delete(`${dir === '/' ? '' : dir}/${part}`)
    } catch {
      // 連不上就算了：韌體下次覆寫同名檔時會把 .part 換掉
    }
  }

  async listOpds(): Promise<DeviceOpdsServer[]> {
    const response = await withTimeout(this.http({ url: this.url(DEVICE_API.opds), method: 'GET' }), this.timeoutMs, 'opds')
    if (response.status === 404) throw new DeviceError('this firmware has no OPDS settings API')
    if (response.status !== 200) throw new DeviceError(`${DEVICE_API.opds}: ${response.status}`)
    const list = JSON.parse(response.text) as DeviceOpdsServer[]
    return Array.isArray(list) ? list : []
  }

  /** 新增或更新 NoteGen 書目：先列出來，同名或同網址的那筆就用 index 更新，不重複新增。 */
  async ensureOpds(entry: OpdsInput): Promise<'added' | 'updated'> {
    const list = await this.listOpds()
    const existing = list.find(item => item.name === OPDS_ENTRY_NAME || item.name === entry.name || sameOpdsUrl(item.url, entry.url))
    if (!existing && list.length >= MAX_OPDS_SERVERS) throw new DeviceError('OPDS list is full')
    const body: Record<string, unknown> = { name: entry.name, url: entry.url, username: entry.username, password: entry.password }
    if (existing) body.index = existing.index
    const response = await withTimeout(this.http({
      url: this.url(DEVICE_API.opds),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), this.timeoutMs, 'opds')
    if (response.status !== 200) throw new DeviceError(`${DEVICE_API.opds}: ${response.status}`)
    return existing ? 'updated' : 'added'
  }
}
