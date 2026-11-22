// almanac ALMNC-52：閱讀器安裝與立即推送。
//   AC #2 只動 /plugins/almanac*/、/Books/Almanac/、/sleep.bmp 與新增的字型（白名單＋計畫檢查＋假閱讀器紀錄）
//   AC #3 推到一半斷線不留下半個檔；重新安裝不重複新增 OPDS 書目
//   AC #4 偵測沒開時不發任何區網請求（偵測只在呼叫 detectReader 時發；設定頁測試另外驗證）
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Briefing } from '@/lib/eink/briefing/types'
import { OPDS_ENTRY_NAME } from '@/lib/eink/crosspoint'
import { loadPluginTemplates } from '@/lib/eink/plugin/files'
import { createFakeReader } from './__fixtures__/fake-reader'
import { CrossPointClient, DeviceError, buildMultipart, sameOpdsUrl } from './client'
import {
  assertAllowedFile, isAllowedDir, isAllowedFile, isSafeDevicePath, isValidFontFileName,
} from './paths'
import { detectReader, disallowedPaths, installToReader, planInstall, planPush, pushNow, runPlan, type DeviceOp } from './plan'

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef'
const SERVER = 'http://192.168.1.5:37424'
const READER = 'http://192.168.1.20'
const templates = () => loadPluginTemplates(path => readFile(join(__dirname, '../../../../public', path), 'utf8'))
const briefing = { date: '2026-11-21', chapters: [], appendix: [], omitted: [], sent: { articleUrls: ['a'], pinPaths: [], reviewPaths: [] } } as unknown as Briefing

/** AC #2：每個改動都落在白名單裡 */
function expectOnlyAllowedWrites(writes: string[], fontFiles: string[] = []) {
  for (const write of writes) {
    const [kind, path] = write.split(' ')
    if (kind === 'opds') continue
    const ok = kind === 'mkdir' ? isAllowedDir(path) : isAllowedFile(path, { fontFiles })
    expect(ok, write).toBe(true)
    expect(path === '/sleep.bmp' || path.startsWith('/plugins') || path.startsWith('/Books') || path.startsWith('/fonts'), write).toBe(true)
  }
}

describe('白名單（AC #2）', () => {
  it('可以動的檔案', () => {
    for (const path of [
      '/sleep.bmp', '/sleep.bmp.part', '/plugins/almanac/device.json', '/plugins/almanac/token.json', '/plugins/almanac-briefing/config.json',
      '/Books/Almanac/almanac-2026-11-21.epub', '/Books/Almanac/almanac-today.epub',
    ]) expect(isAllowedFile(path), path).toBe(true)
    expect(isAllowedFile('/fonts/NotoSerifTC.ttf', { fontFiles: ['NotoSerifTC.ttf'] })).toBe(true)
  })

  it('不能動的檔案', () => {
    for (const path of [
      '/', '/sleep.bmp/', '/sleep.png', '/Books/other.epub', '/Books/Almanac/sub/x.epub', '/Books/AlmanacX/x.epub', '/plugins/other/device.json',
      '/plugins/almanacx/device.json', '/plugins/almanac/../other/device.json', '/plugins/almanac/sub/x.json', '/plugins/device.json',
      '/.crosspoint/opds.json', '/.crosspoint/wifi.json', '/fonts/Other.ttf', '/plugins/almanac', 'plugins/almanac/x', '/Books/Almanac/../x',
      '/Books/Almanac/./x', '/Books//Almanac/x', '/Books/Almanac/a\\b', '/Books/Almanac/a\nb',
    ]) expect(isAllowedFile(path), path).toBe(false)
    expect(isAllowedFile('/fonts/NotoSerifTC.ttf')).toBe(false)
    expect(() => assertAllowedFile('/etc/passwd')).toThrow()
  })

  it('可以建的資料夾只有 almanac 自己的與它們的上層', () => {
    for (const path of ['/plugins', '/plugins/almanac', '/plugins/almanac-briefing', '/Books', '/Books/Almanac', '/fonts']) expect(isAllowedDir(path), path).toBe(true)
    for (const path of ['/', '/Books/Other', '/plugins/other', '/.crosspoint', '/plugins/almanac/sub', '/Books/Almanac/x']) expect(isAllowedDir(path), path).toBe(false)
    expect(isSafeDevicePath('/a/../b')).toBe(false)
    expect(isSafeDevicePath('/')).toBe(true)
  })

  it('字型檔名', () => {
    expect(isValidFontFileName('NotoSerifTC-Regular.ttf')).toBe(true)
    expect(isValidFontFileName('LXGW WenKai.otf')).toBe(true)
    expect(isValidFontFileName('../x.ttf')).toBe(false)
    expect(isValidFontFileName('a/b.ttf')).toBe(false)
    expect(isValidFontFileName('font.woff2')).toBe(false)
  })

  it('計畫裡只要有一個路徑不合，整份不做、不發請求', async () => {
    const reader = createFakeReader()
    const ops: DeviceOp[] = [
      { kind: 'mkdir', path: '/plugins' },
      { kind: 'upload', path: '/Books/other.epub', bytes: new Uint8Array([1]), contentType: 'x' },
    ]
    expect(disallowedPaths(ops)).toEqual(['/Books/other.epub'])
    await expect(runPlan(reader.http, READER, ops)).rejects.toThrow(/not allowed/)
    expect(reader.requests).toHaveLength(0)
  })

  it('用戶端本身也擋：刪除或上傳白名單外的路徑直接丟錯', async () => {
    const reader = createFakeReader({ '/Books/keep.epub': 'x' })
    const client = new CrossPointClient(reader.http, READER)
    await expect(client.delete('/Books/keep.epub')).rejects.toThrow()
    await expect(client.uploadVerified('/notes.md', new Uint8Array([1]))).rejects.toThrow()
    await expect(client.ensureDir('/Other')).rejects.toThrow()
    expect(reader.requests).toHaveLength(0)
  })
})

describe('planInstall', () => {
  it('列出外掛檔、資料夾與 OPDS 書目；預設不裝今日簡報外掛、不裝字型', async () => {
    const ops = planInstall(await templates(), { server: SERVER, token: TOKEN })
    expect(ops.map(op => op.kind === 'opds' ? `opds ${op.entry.url}` : `${op.kind} ${op.path}`)).toEqual([
      'mkdir /plugins', 'mkdir /plugins/almanac',
      'upload /plugins/almanac/device.json', 'upload /plugins/almanac/README.md', 'upload /plugins/almanac/config.json', 'upload /plugins/almanac/token.json',
      `opds ${SERVER}/opds`,
    ])
    const opds = ops.at(-1)
    expect(opds).toMatchObject({ kind: 'opds', entry: { name: OPDS_ENTRY_NAME, username: 'almanac', password: TOKEN } })
    expect(disallowedPaths(ops)).toEqual([])
  })

  it('勾選今日簡報外掛與字型時多出對應的檔，仍全在白名單內', async () => {
    const ops = planInstall(await templates(), {
      server: SERVER, token: TOKEN, includeBriefing: true, font: { name: 'NotoSerifTC.ttf', bytes: new Uint8Array([0, 1, 0, 0]) },
    })
    const paths = ops.flatMap(op => op.kind === 'opds' ? [] : [op.path])
    expect(paths).toContain('/plugins/almanac-briefing/device.json')
    expect(paths).toContain('/Books/Almanac')
    expect(paths).toContain('/fonts/NotoSerifTC.ttf')
    expect(disallowedPaths(ops)).toEqual([])
  })

  it('字型檔名不合法就拒絕', async () => {
    expect(() => planInstall({} as never, { server: SERVER, token: TOKEN, font: { name: '../x.ttf', bytes: new Uint8Array() } })).toThrow()
  })
})

describe('一鍵安裝（假閱讀器）', () => {
  it('新閱讀器一次裝好：外掛檔含伺服器網址與 token，OPDS 書目加一筆；只動白名單', async () => {
    const reader = createFakeReader({ '/Books/Mine/book.epub': 'mine', '/sleep.bmp': 'old', '/.crosspoint/opds.json': '{}' })
    const report = await installToReader(reader.http, READER, await templates(), { server: SERVER, token: TOKEN })
    expect(report.opds).toBe('added')
    const text = (path: string) => new TextDecoder().decode(reader.files.get(path))
    expect(JSON.parse(text('/plugins/almanac/config.json'))).toEqual({ server: SERVER })
    expect(JSON.parse(text('/plugins/almanac/token.json'))).toEqual({ token: TOKEN })
    expect(text('/Books/Mine/book.epub')).toBe('mine')
    expect(text('/sleep.bmp')).toBe('old')
    expect(reader.opds).toEqual([{ name: OPDS_ENTRY_NAME, url: `${SERVER}/opds`, username: 'almanac', password: TOKEN }])
    expectOnlyAllowedWrites(reader.writes)
  })

  it('重新安裝不重複新增 OPDS 書目（換了 IP 或 token 也是更新同一筆），其他書目不動', async () => {
    const reader = createFakeReader({}, { opds: [{ name: 'Calibre', url: 'http://calibre.local/opds', username: 'me', password: 'pw' }] })
    const all = await templates()
    await installToReader(reader.http, READER, all, { server: SERVER, token: TOKEN })
    const second = await installToReader(reader.http, READER, all, { server: SERVER, token: TOKEN })
    expect(second.opds).toBe('updated')
    const newToken = 'f'.repeat(48)
    await installToReader(reader.http, READER, all, { server: 'http://192.168.1.99:37424', token: newToken })
    expect(reader.opds).toHaveLength(2)
    expect(reader.opds[0].name).toBe('Calibre')
    expect(reader.opds[1]).toMatchObject({ name: OPDS_ENTRY_NAME, url: 'http://192.168.1.99:37424/opds', password: newToken })
  })

  it('同網址但名稱不同的舊書目也視為同一筆', async () => {
    const reader = createFakeReader({}, { opds: [{ name: 'old name', url: `${SERVER}/opds/`, username: 'almanac', password: 'x' }] })
    const report = await installToReader(reader.http, READER, await templates(), { server: SERVER, token: TOKEN })
    expect(report.opds).toBe('updated')
    expect(reader.opds).toHaveLength(1)
  })

  it('OPDS 書目滿了（8 個）就報錯，不硬塞', async () => {
    const full = Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, url: `http://c${i}/opds`, username: '', password: '' }))
    const reader = createFakeReader({}, { opds: full })
    await expect(installToReader(reader.http, READER, await templates(), { server: SERVER, token: TOKEN })).rejects.toThrow(/full/)
  })

  it('字型已經有同名同大小的就不重傳', async () => {
    const font = new Uint8Array([0, 1, 0, 0, 9])
    const reader = createFakeReader({ '/fonts/Noto.ttf': font })
    const report = await installToReader(reader.http, READER, await templates(), { server: SERVER, token: TOKEN, font: { name: 'Noto.ttf', bytes: font } })
    expect(report.skipped).toEqual(['/fonts/Noto.ttf'])
    expectOnlyAllowedWrites(reader.writes, ['Noto.ttf'])
  })
})

describe('上傳中斷（AC #3）', () => {
  it('推到一半斷線：舊檔不動、不留下 .part，而且不 commitSent', async () => {
    const reader = createFakeReader({ '/sleep.bmp': 'old-image' }, { dropUpload: path => path === '/sleep.bmp' })
    const commit = vi.fn(async () => {})
    await expect(pushNow(reader.http, READER, { date: '2026-11-21', epub: new Uint8Array([1, 2, 3]), sleep: new Uint8Array(100), briefing }, commit))
      .rejects.toThrow(/network/)
    expect(new TextDecoder().decode(reader.files.get('/sleep.bmp'))).toBe('old-image')
    expect([...reader.files.keys()].some(path => path.endsWith('.part'))).toBe(false)
    expect(commit).not.toHaveBeenCalled()
  })

  it('寫進去的大小不對就刪掉並報錯', async () => {
    const reader = createFakeReader({}, { corruptUpload: path => path.endsWith('.epub') })
    const commit = vi.fn(async () => {})
    await expect(pushNow(reader.http, READER, { date: '2026-11-21', epub: new Uint8Array(50), sleep: new Uint8Array(10), briefing }, commit))
      .rejects.toBeInstanceOf(DeviceError)
    expect(reader.files.has('/Books/Almanac/almanac-2026-11-21.epub')).toBe(false)
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('不認 overwrite=1 的韌體（實機 ALMNC-44）', () => {
  it('重新安裝時同名檔先刪再傳，外掛與休眠圖都換成新的，只動白名單', async () => {
    const reader = createFakeReader({ '/plugins/almanac/device.json': '{}', '/sleep.bmp': 'old-image' }, { ignoreOverwrite: true })
    await installToReader(reader.http, READER, await templates(), { server: SERVER, token: TOKEN })
    expect(new TextDecoder().decode(reader.files.get('/plugins/almanac/device.json'))).toContain('sleep.enter')
    const commit = vi.fn(async () => {})
    await pushNow(reader.http, READER, { date: '2026-11-21', epub: new Uint8Array([1, 2, 3]), sleep: new Uint8Array([4, 5]), briefing }, commit)
    expect(reader.files.get('/sleep.bmp')).toEqual(new Uint8Array([4, 5]))
    expect(commit).toHaveBeenCalledWith(briefing)
    expectOnlyAllowedWrites(reader.writes)
  })
})

describe('立即推送', () => {
  it('今日簡報放進 /Books/Almanac/、休眠畫面寫到 /sleep.bmp，都確認後才 commitSent；只動白名單', async () => {
    const reader = createFakeReader({ '/Books/Mine/book.epub': 'mine' })
    const commit = vi.fn(async () => {})
    await pushNow(reader.http, READER, { date: '2026-11-21', epub: new Uint8Array([1, 2, 3]), sleep: new Uint8Array([4, 5]), briefing }, commit)
    expect(reader.files.get('/Books/Almanac/almanac-2026-11-21.epub')).toEqual(new Uint8Array([1, 2, 3]))
    expect(reader.files.get('/sleep.bmp')).toEqual(new Uint8Array([4, 5]))
    expect(commit).toHaveBeenCalledWith(briefing)
    expectOnlyAllowedWrites(reader.writes)
  })

  it('書庫裡只保留最新 7 本推送過的簡報，其他檔不動', async () => {
    const initial: Record<string, string> = { '/Books/Almanac/almanac-today.epub': 'plugin', '/Books/Almanac/mine.epub': 'keep' }
    for (let day = 1; day <= 9; day++) initial[`/Books/Almanac/almanac-2026-11-${String(day).padStart(2, '0')}.epub`] = 'x'
    const reader = createFakeReader(initial)
    await pushNow(reader.http, READER, { date: '2026-11-21', epub: new Uint8Array([1]), sleep: new Uint8Array([2]), briefing }, async () => {})
    const left = [...reader.files.keys()].filter(path => path.startsWith('/Books/Almanac/almanac-2026')).sort()
    expect(left).toHaveLength(7)
    expect(left.at(-1)).toBe('/Books/Almanac/almanac-2026-11-21.epub')
    expect(reader.files.has('/Books/Almanac/almanac-today.epub')).toBe(true)
    expect(reader.files.has('/Books/Almanac/mine.epub')).toBe(true)
  })

  it('planPush 只寫兩個檔', () => {
    const ops = planPush({ date: '2026-11-21', epub: new Uint8Array(), sleep: new Uint8Array() })
    expect(ops.filter(op => op.kind === 'upload').map(op => op.kind === 'upload' && op.path)).toEqual(['/Books/Almanac/almanac-2026-11-21.epub', '/sleep.bmp'])
    expect(() => planPush({ date: '../x', epub: new Uint8Array(), sleep: new Uint8Array() })).toThrow()
  })
})

describe('偵測（AC #4）', () => {
  it('只在呼叫 detectReader 時發一個 GET /api/status', async () => {
    const reader = createFakeReader()
    expect(reader.requests).toHaveLength(0)
    const status = await detectReader(reader.http, READER)
    expect(status).toMatchObject({ firmwareFamily: 'crosspoint', device: 'X4' })
    expect(reader.requests.map(request => `${request.method} ${request.url}`)).toEqual([`GET ${READER}/api/status`])
  })

  it('回應不是 CrossPoint 就當作找不到', async () => {
    await expect(detectReader(async () => ({ status: 200, text: '{"hello":1}' }), READER)).rejects.toThrow()
    await expect(detectReader(async () => ({ status: 500, text: '' }), READER)).rejects.toThrow()
  })
})

describe('小工具', () => {
  it('multipart 格式', () => {
    const { body, contentType } = buildMultipart('a.bmp', new Uint8Array([1, 2]), 'image/bmp', 'B')
    expect(contentType).toBe('multipart/form-data; boundary=B')
    const text = new TextDecoder().decode(body)
    expect(text).toContain('Content-Disposition: form-data; name="file"; filename="a.bmp"')
    expect(text.endsWith('\r\n--B--\r\n')).toBe(true)
  })

  it('sameOpdsUrl', () => {
    expect(sameOpdsUrl('http://H:1/opds/', 'http://h:1/opds')).toBe(true)
    expect(sameOpdsUrl('http://h:1/opds', 'http://h:2/opds')).toBe(false)
  })
})
