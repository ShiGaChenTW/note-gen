// almanac ALMNC-51：CrossPoint SD 外掛檔——public/eink-plugin/ 的靜態檔符合格式，安裝時代入網址與 token。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BRIEFING_DEST, BRIEFING_PLUGIN, MAX_PLUGIN_NAME_BYTES, MAX_PLUGIN_PATH_BYTES, PLUGIN_NAMES, SLEEP_DEST, SLEEP_EVENT, SLEEP_PLUGIN,
  pluginDir,
} from '@/lib/eink/crosspoint'
import { LAN_EPUB_PATH, LAN_SLEEP_PATH } from '@/lib/eink/lan/urls'
import { PluginTemplateError, loadPluginTemplates, normalizePluginServer, renderPluginFiles } from './files'

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef'
const SERVER = 'http://192.168.1.5:37424'
const publicDir = join(__dirname, '../../../../public')
const templates = () => loadPluginTemplates(path => readFile(join(publicDir, path), 'utf8'))

interface DeviceJson {
  title: string
  description: string
  token: { file: string, path: string }
  config: { file: string }
  browse?: unknown
  events: Record<string, { download?: { url: string, dest: string, headers?: Record<string, string> }, request?: unknown }>
}

describe('外掛靜態檔（public/eink-plugin/）', () => {
  it('外掛名稱與路徑在韌體的長度限制內', () => {
    for (const name of PLUGIN_NAMES) {
      expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(MAX_PLUGIN_NAME_BYTES)
      expect(new TextEncoder().encode(pluginDir(name)).length).toBeLessThanOrEqual(MAX_PLUGIN_PATH_BYTES)
      expect(pluginDir(name)).toMatch(/^\/plugins\/almanac[a-z-]*$/)
    }
  })

  it('休眠畫面外掛：只宣告 sleep.enter 一個下載，抓區網服務的 sleep.bmp 到 /sleep.bmp', async () => {
    const device = JSON.parse((await templates())[SLEEP_PLUGIN]['device.json']) as DeviceJson
    expect(device.browse).toBeUndefined()
    expect(Object.keys(device.events)).toEqual([SLEEP_EVENT])
    const { download, request } = device.events[SLEEP_EVENT]
    expect(request).toBeUndefined()
    expect(download!.dest).toBe(SLEEP_DEST)
    expect(download!.url).toBe(`{cfg.server}${LAN_SLEEP_PATH}?token={token}`)
    expect(download!.headers).toEqual({ Authorization: 'Bearer {token}' })
    expect(device.token).toEqual({ file: 'token.json', path: 'token' })
    expect(device.config).toEqual({ file: 'config.json' })
    expect(device.title).toBe('Almanac')
  })

  it('今日簡報外掛（變體）：另一個外掛、下載到 /Books/Almanac/', async () => {
    const device = JSON.parse((await templates())[BRIEFING_PLUGIN]['device.json']) as DeviceJson
    expect(Object.keys(device.events)).toEqual([SLEEP_EVENT])
    expect(device.events[SLEEP_EVENT].download!.url).toBe(`{cfg.server}${LAN_EPUB_PATH}?token={token}`)
    expect(device.events[SLEEP_EVENT].download!.dest).toBe(BRIEFING_DEST)
    expect(BRIEFING_DEST.startsWith('/Books/Almanac/')).toBe(true)
  })

  it('dest 都是絕對路徑、沒有 ..；device.json 裡沒有寫死的網址或 token', async () => {
    const all = await templates()
    for (const name of PLUGIN_NAMES) {
      const raw = all[name]['device.json']
      const device = JSON.parse(raw) as DeviceJson
      for (const handler of Object.values(device.events)) {
        expect(handler.download!.dest.startsWith('/')).toBe(true)
        expect(handler.download!.dest.split('/')).not.toContain('..')
      }
      expect(raw).not.toMatch(/https?:\/\//)
      expect(raw).not.toMatch(/[0-9a-f]{32,}/)
    }
  })

  it('README 是繁中、在 16KB 內、有 {{server}} 位置', async () => {
    const all = await templates()
    for (const name of PLUGIN_NAMES) {
      const readme = all[name]['README.md']
      expect(readme).toContain('{{server}}')
      expect(readme).toMatch(/電子紙/)
      expect(new TextEncoder().encode(readme).length).toBeLessThan(16 * 1024)
    }
    expect(all[SLEEP_PLUGIN]['README.md']).toContain('Sleep Screen 選 Custom')
  })
})

describe('renderPluginFiles', () => {
  it('預設只產生休眠畫面外掛的四個檔，網址與 token 寫進 config.json／token.json', async () => {
    const files = renderPluginFiles(await templates(), { server: `${SERVER}/`, token: TOKEN })
    expect(files.map(file => file.path)).toEqual([
      '/plugins/almanac/device.json', '/plugins/almanac/README.md', '/plugins/almanac/config.json', '/plugins/almanac/token.json',
    ])
    const byPath = Object.fromEntries(files.map(file => [file.path, file.content]))
    expect(JSON.parse(byPath['/plugins/almanac/config.json'])).toEqual({ server: SERVER })
    expect(JSON.parse(byPath['/plugins/almanac/token.json'])).toEqual({ token: TOKEN })
    expect(byPath['/plugins/almanac/README.md']).toContain(`伺服器：${SERVER}`)
    expect(byPath['/plugins/almanac/README.md']).not.toContain(TOKEN)
    expect(byPath['/plugins/almanac/device.json']).not.toContain(TOKEN)
  })

  it('選擇也裝今日簡報外掛時多四個檔', async () => {
    const files = renderPluginFiles(await templates(), { server: SERVER, token: TOKEN, includeBriefing: true })
    expect(files).toHaveLength(8)
    expect(files.filter(file => file.path.startsWith('/plugins/almanac-briefing/'))).toHaveLength(4)
  })

  it('網址或 token 不對就拒絕', async () => {
    const all = await templates()
    expect(() => renderPluginFiles(all, { server: 'ftp://x', token: TOKEN })).toThrow(PluginTemplateError)
    expect(() => renderPluginFiles(all, { server: `${SERVER}/eink`, token: TOKEN })).toThrow(PluginTemplateError)
    expect(() => renderPluginFiles(all, { server: SERVER, token: 'nope' })).toThrow(PluginTemplateError)
    expect(normalizePluginServer('http://user:pw@h:1')).toBeNull()
    expect(normalizePluginServer('http://h:1?x=1')).toBeNull()
    expect(normalizePluginServer(' http://192.168.1.5:37424 ')).toBe(SERVER)
  })
})
