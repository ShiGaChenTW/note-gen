// almanac ALMNC-50：區網服務的前端部分——網址、推送快取、只在真的送完後 commitSent、開關條件。
// 伺服器本身（驗證、連錯封鎖、路由白名單、路徑穿越、真的開 HTTP 打）在 src-tauri/src/eink_lan.rs 的 Rust 測試。
import { describe, expect, it, vi } from 'vitest'
import type { Briefing } from '@/lib/eink/briefing/types'
import { DEFAULT_EINK_SETTINGS } from '@/lib/eink/settings'
import { configureLan, publishLan, sha256Hex, toBase64, type LanPublishInput } from './bridge'
import { createLanPublisher, type LanContent } from './publisher'
import { lanConfigFromStore } from './service'
import { lanEpubUrl, lanOpdsUrl, lanServerBase, lanSleepUrl, nextLocalMidnight, redactToken } from './urls'

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef'

function briefing(date: string, marker = ''): Briefing {
  return {
    date, chapters: [], appendix: [], omitted: [],
    sent: { articleUrls: marker ? [marker] : [], pinPaths: [], reviewPaths: [], reportPeriod: null },
  } as unknown as Briefing
}

describe('網址', () => {
  it('組出外掛與 OPDS 要填的網址', () => {
    const base = lanServerBase('192.168.1.5:37424')
    expect(base).toBe('http://192.168.1.5:37424')
    expect(lanServerBase('http://192.168.1.5:37424/')).toBe('http://192.168.1.5:37424')
    expect(lanSleepUrl(base, TOKEN)).toBe(`http://192.168.1.5:37424/eink/sleep.bmp?token=${TOKEN}`)
    expect(lanEpubUrl(base, TOKEN)).toBe(`http://192.168.1.5:37424/eink/today.epub?token=${TOKEN}`)
    expect(lanOpdsUrl(base)).toBe('http://192.168.1.5:37424/opds')
  })

  it('顯示時遮住 token', () => {
    const shown = redactToken(lanSleepUrl('http://h:1', TOKEN), TOKEN)
    expect(shown).not.toContain(TOKEN)
    expect(shown).toContain('cdef')
  })

  it('有效期限是本地隔天零點', () => {
    const at = new Date(2026, 10, 21, 23, 59)
    expect(new Date(nextLocalMidnight(at))).toEqual(new Date(2026, 10, 22, 0, 0))
  })
})

describe('bridge', () => {
  it('關閉時不把 token 傳給 Rust', async () => {
    const invoke = vi.fn(async () => ({}))
    await configureLan(false, 37424, TOKEN, invoke as never)
    expect(invoke).toHaveBeenCalledWith('eink_lan_configure', { enabled: false, port: 37424, token: '' })
    await configureLan(true, 37424, TOKEN, invoke as never)
    expect(invoke).toHaveBeenLastCalledWith('eink_lan_configure', { enabled: true, port: 37424, token: TOKEN })
  })

  it('推送時把位元組轉成 base64', async () => {
    const invoke = vi.fn(async () => undefined)
    await publishLan({ kind: 'sleep', date: '2026-11-21', hash: 'ab', title: 't', validUntil: 1, bytes: new Uint8Array([1, 2, 255]) }, invoke as never)
    expect(invoke).toHaveBeenCalledWith('eink_lan_publish', expect.objectContaining({ kind: 'sleep', bytes: 'AQL/' }))
    expect(toBase64(new Uint8Array(70_000).fill(65))).toHaveLength(93_336)
  })

  it('sha256Hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

function setup(contents: LanContent[]) {
  const published: LanPublishInput[] = []
  const commits: Briefing[] = []
  const makeEpub = vi.fn()
  let index = 0
  const publisher = createLanPublisher({
    load: async () => contents[Math.min(index++, contents.length - 1)],
    publish: async input => { published.push(input) },
    commit: async b => { commits.push(b) },
    hash: async bytes => `h${Array.from(bytes).join('-')}`,
    now: () => new Date(2026, 10, 21, 8, 0),
    intervalMs: 0,
    report: () => {},
  })
  return { publisher, published, commits, makeEpub }
}

function content(date: string, key: string, epub: number[], spy?: () => void): LanContent {
  const b = briefing(date, key)
  return {
    date, briefing: b, briefingKey: key, sleep: new Uint8Array([9]), title: `今日簡報 ${date}`,
    makeEpub: async () => { spy?.(); return new Uint8Array(epub) },
  }
}

describe('createLanPublisher', () => {
  it('推休眠畫面與今日簡報，有效到隔天零點', async () => {
    const { publisher, published } = setup([content('2026-11-21', 'a', [1, 2])])
    await publisher.refresh()
    expect(published.map(item => item.kind)).toEqual(['sleep', 'epub'])
    expect(published[1]).toMatchObject({ date: '2026-11-21', hash: 'h1-2', title: '今日簡報 2026-11-21' })
    expect(published[0].validUntil).toBe(new Date(2026, 10, 22).getTime())
  })

  it('當天資料沒變就沿用上次的 EPUB；變了才重做', async () => {
    const spy = vi.fn()
    const { publisher, published } = setup([
      content('2026-11-21', 'same', [1], spy), content('2026-11-21', 'same', [1], spy), content('2026-11-21', 'changed', [2], spy),
    ])
    await publisher.refresh()
    await publisher.refresh()
    expect(spy).toHaveBeenCalledTimes(1)
    await publisher.refresh()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(published.filter(item => item.kind === 'epub').map(item => item.hash)).toEqual(['h1', 'h1', 'h2'])
  })

  it('同時好幾個重算請求合併成一次', async () => {
    const { publisher, published } = setup([content('2026-11-21', 'a', [1])])
    await Promise.all([publisher.refresh(), publisher.refresh(), publisher.refresh()])
    expect(published).toHaveLength(2)
  })

  it('只有整份送完（downloaded）才 commitSent，同一份只一次；不認得的份不 commit', async () => {
    const { publisher, commits } = setup([content('2026-11-21', 'a', [1, 2])])
    await publisher.refresh()
    expect(commits).toHaveLength(0)
    await publisher.onDownloaded({ kind: 'sleep', date: '2026-11-21', hash: 'h9' })
    await publisher.onDownloaded({ kind: 'epub', date: '2026-11-21', hash: 'unknown' })
    await publisher.onDownloaded({ kind: 'epub', date: '2026-11-20', hash: 'h1-2' })
    expect(commits).toHaveLength(0)
    await publisher.onDownloaded({ kind: 'epub', date: '2026-11-21', hash: 'h1-2' })
    await publisher.onDownloaded({ kind: 'epub', date: '2026-11-21', hash: 'h1-2' })
    expect(commits).toHaveLength(1)
    expect(commits[0].date).toBe('2026-11-21')
  })

  it('產生失敗就不推（Rust 繼續送舊的或回 503）', async () => {
    const published: LanPublishInput[] = []
    const publisher = createLanPublisher({
      load: async () => { throw new Error('boom') },
      publish: async input => { published.push(input) },
      commit: async () => {},
      hash: async () => 'x',
      intervalMs: 0,
      report: () => {},
    })
    await publisher.refresh()
    expect(published).toHaveLength(0)
  })
})

describe('開關條件', () => {
  const state = (patch: Partial<typeof DEFAULT_EINK_SETTINGS>, token = TOKEN, loaded = true) => ({
    loaded, token, settings: { ...DEFAULT_EINK_SETTINGS, ...patch },
  }) as never

  it('預設關閉；啟用電子紙同步＋區網服務都打開才啟動', () => {
    expect(lanConfigFromStore(state({})).on).toBe(false)
    expect(lanConfigFromStore(state({ lanServer: true })).on).toBe(false)
    expect(lanConfigFromStore(state({ enabled: true })).on).toBe(false)
    expect(lanConfigFromStore(state({ enabled: true, lanServer: true }))).toEqual({ on: true, port: 37424, token: TOKEN })
    expect(lanConfigFromStore(state({ enabled: true, lanServer: true }, '')).on).toBe(false)
    expect(lanConfigFromStore(state({ enabled: true, lanServer: true }, TOKEN, false)).on).toBe(false)
  })
})
