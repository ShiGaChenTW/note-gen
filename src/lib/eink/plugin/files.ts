// Fork（almanac ALMNC-51）：almanac 的 CrossPoint SD 外掛檔。
// 外掛只用宣告式的 device.json（不執行程式碼）：sleep.enter 時把區網服務的 sleep.bmp 下載到 /sleep.bmp。
// 靜態檔（device.json、README.md）放在 public/eink-plugin/<名稱>/；伺服器網址與 token 在安裝時（ALMNC-52）
// 由 renderPluginFiles 寫進 config.json、token.json 和 README 的 {{server}}。格式依據見 src/lib/eink/crosspoint.ts。
import {
  BRIEFING_PLUGIN, MAX_MANIFEST_BYTES, MAX_README_BYTES, MAX_SMALL_FILE_BYTES, PLUGIN_CONFIG_FILE, PLUGIN_STATIC_FILES,
  PLUGIN_TOKEN_FILE, SLEEP_PLUGIN, pluginConfigJson, pluginDir, pluginTokenJson, type PluginName,
} from '@/lib/eink/crosspoint'
import { isValidEinkToken } from '@/lib/eink/settings'

export type PluginTemplates = Record<PluginName, Record<typeof PLUGIN_STATIC_FILES[number], string>>

export interface PluginFile {
  /** 電子紙上的絕對路徑，例如 /plugins/almanac/device.json */
  path: string
  content: string
}

export interface RenderOptions {
  /** 區網服務的網址，例如 http://192.168.1.5:37424 */
  server: string
  token: string
  /** 也裝今日簡報外掛（預設不裝，見 crosspoint.ts） */
  includeBriefing?: boolean
}

export class PluginTemplateError extends Error {}

/** 只接受 http(s)://主機[:埠]，不能有路徑、帳密、參數。 */
export function normalizePluginServer(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 代入網址與 token，產生要寫到電子紙上的檔案（純函式）。 */
export function renderPluginFiles(templates: PluginTemplates, options: RenderOptions): PluginFile[] {
  const server = normalizePluginServer(options.server)
  if (!server) throw new PluginTemplateError('invalid server url')
  if (!isValidEinkToken(options.token)) throw new PluginTemplateError('invalid token')
  const names: PluginName[] = options.includeBriefing ? [SLEEP_PLUGIN, BRIEFING_PLUGIN] : [SLEEP_PLUGIN]
  const files: PluginFile[] = []
  for (const name of names) {
    const dir = pluginDir(name)
    const template = templates[name]
    const device = template['device.json']
    try {
      JSON.parse(device)
    } catch {
      throw new PluginTemplateError(`${name}/device.json is not valid JSON`)
    }
    if (device.includes(options.token)) throw new PluginTemplateError('device.json must not contain the token')
    if (utf8Bytes(device) > MAX_MANIFEST_BYTES) throw new PluginTemplateError(`${name}/device.json is too large`)
    const readme = template['README.md'].split('{{server}}').join(server)
    if (utf8Bytes(readme) > MAX_README_BYTES) throw new PluginTemplateError(`${name}/README.md is too large`)
    const token = pluginTokenJson(options.token)
    const config = pluginConfigJson(server)
    if (utf8Bytes(token) > MAX_SMALL_FILE_BYTES || utf8Bytes(config) > MAX_SMALL_FILE_BYTES) throw new PluginTemplateError('config too large')
    files.push(
      { path: `${dir}/device.json`, content: device },
      { path: `${dir}/README.md`, content: readme },
      { path: `${dir}/${PLUGIN_CONFIG_FILE}`, content: config },
      { path: `${dir}/${PLUGIN_TOKEN_FILE}`, content: token },
    )
  }
  return files
}

/** 讀 public/eink-plugin/ 的靜態檔（app 內用 fetch；測試直接讀檔）。 */
export async function loadPluginTemplates(
  readText: (path: string) => Promise<string> = async path => {
    const response = await fetch(path)
    if (!response.ok) throw new PluginTemplateError(`cannot load ${path}`)
    return response.text()
  },
): Promise<PluginTemplates> {
  const entries = await Promise.all([SLEEP_PLUGIN, BRIEFING_PLUGIN].map(async name => {
    const files = await Promise.all(PLUGIN_STATIC_FILES.map(async file => [file, await readText(`/eink-plugin/${name}/${file}`)] as const))
    return [name, Object.fromEntries(files)] as const
  }))
  return Object.fromEntries(entries) as PluginTemplates
}
