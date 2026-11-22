// almanac ALMNC-52：測試用的假 CrossPoint 閱讀器（File Transfer 模式），照 docs/webserver-endpoints.md 的行為：
// overwrite 上傳先寫 <name>.part、收完才換掉舊檔；斷線時留下 .part、舊檔不動。記錄每一個會改動 SD 卡的請求。
import type { HttpFn, HttpRequest } from '../client'

export interface FakeReaderOptions {
  /** 這個路徑的上傳在傳到一半時斷線 */
  dropUpload?: (path: string) => boolean
  /** 上傳成功但存下來的大小不對（模擬 SD 卡寫壞） */
  corruptUpload?: (path: string) => boolean
  opds?: Array<{ name: string, url: string, username: string, password: string }>
  /** 模擬不認 overwrite=1 的韌體（實機 ALMNC-44）：同名檔一律回 400 File already exists */
  ignoreOverwrite?: boolean
}

export function createFakeReader(initial: Record<string, string | Uint8Array> = {}, options: FakeReaderOptions = {}) {
  const files = new Map<string, Uint8Array>()
  const dirs = new Set<string>(['/'])
  const writes: string[] = []
  const requests: HttpRequest[] = []
  const opds = [...(options.opds ?? [])]
  const addDirs = (path: string) => {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) dirs.add(`/${parts.slice(0, i).join('/')}`)
  }
  for (const [path, value] of Object.entries(initial)) {
    if (path.endsWith('/')) {
      addDirs(`${path}x`)
      continue
    }
    files.set(path, typeof value === 'string' ? new TextEncoder().encode(value) : value)
    addDirs(path)
  }

  const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`

  function parseMultipart(body: Uint8Array): { name: string, bytes: Uint8Array } {
    const text = new TextDecoder('latin1').decode(body)
    const name = /filename="([^"]*)"/.exec(text)?.[1] ?? ''
    const start = text.indexOf('\r\n\r\n') + 4
    const end = text.lastIndexOf('\r\n--')
    return { name, bytes: body.slice(start, end) }
  }

  const http: HttpFn = async request => {
    requests.push(request)
    const url = new URL(request.url)
    const form = typeof request.body === 'string' && request.headers?.['Content-Type']?.includes('urlencoded')
      ? new URLSearchParams(request.body)
      : null
    switch (`${request.method} ${url.pathname}`) {
      case 'GET /api/status':
        return { status: 200, text: JSON.stringify({ version: '2.1.0', firmwareFamily: 'crosspoint', ip: url.hostname, mode: 'STA', device: 'X4' }) }
      case 'GET /api/files': {
        const dir = url.searchParams.get('path') ?? '/'
        if (!dirs.has(dir)) return { status: 404, text: 'not found' }
        const prefix = dir === '/' ? '/' : `${dir}/`
        const entries = [
          ...[...dirs].filter(d => d !== '/' && d.startsWith(prefix) && !d.slice(prefix.length).includes('/'))
            .map(d => ({ name: d.slice(prefix.length), size: 0, isDirectory: true, isEpub: false })),
          ...[...files].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
            .map(([p, bytes]) => ({ name: p.slice(prefix.length), size: bytes.length, isDirectory: false, isEpub: p.endsWith('.epub') })),
        ]
        return { status: 200, text: JSON.stringify(entries) }
      }
      case 'POST /mkdir': {
        const path = join(form!.get('path') ?? '/', form!.get('name')!)
        writes.push(`mkdir ${path}`)
        dirs.add(path)
        return { status: 200, text: 'ok' }
      }
      case 'POST /delete': {
        const path = form!.get('path')!
        writes.push(`delete ${path}`)
        files.delete(path)
        return { status: 200, text: 'ok' }
      }
      case 'POST /upload': {
        const dir = url.searchParams.get('path') ?? '/'
        const { name, bytes } = parseMultipart(request.body as Uint8Array)
        const path = join(dir, name)
        writes.push(`upload ${path}`)
        if (!dirs.has(dir)) return { status: 400, text: 'no such folder' }
        if (options.dropUpload?.(path)) {
          files.set(`${path}.part`, bytes.slice(0, Math.floor(bytes.length / 2)))
          throw new TypeError('network connection was lost')
        }
        if (files.has(path) && (options.ignoreOverwrite || url.searchParams.get('overwrite') !== '1')) return { status: 400, text: `File already exists: ${name}` }
        files.set(path, options.corruptUpload?.(path) ? bytes.slice(1) : bytes)
        return { status: 200, text: `File uploaded successfully: ${name}` }
      }
      case 'GET /api/opds':
        return { status: 200, text: JSON.stringify(opds.map((entry, index) => ({ index, name: entry.name, url: entry.url, username: entry.username, hasPassword: !!entry.password }))) }
      case 'POST /api/opds': {
        const entry = JSON.parse(request.body as string) as { index?: number, name: string, url: string, username: string, password: string }
        writes.push(`opds ${entry.index ?? 'new'}`)
        const { index, ...rest } = entry
        if (index === undefined) opds.push(rest)
        else opds[index] = rest
        return { status: 200, text: 'ok' }
      }
      default:
        return { status: 404, text: 'not found' }
    }
  }

  return { http, files, dirs, writes, requests, opds }
}
