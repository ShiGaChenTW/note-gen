// Fork（almanac ALMNC-50）：把休眠畫面與今日簡報推進 Rust 區網服務的快取。
//
// 橋接設計（詳見 src-tauri/src/eink_lan.rs 開頭）：
//   - Rust 只送前端推進去的「最後一份完整位元組」；快取太舊時發 eink-lan-refresh，這裡收到就重算。
//   - 休眠畫面每次都重畫（角落有「更新於 HH:MM」，很便宜）；今日簡報只在當天的資料變了才重做 EPUB
//     （用 Briefing 本身當鍵比對，資料一樣就沿用上次的位元組，不重抓圖片）。
//   - 每份 EPUB 記下它是哪一份 Briefing；Rust 回報 eink-lan-downloaded（整份送完）才呼叫 commitSent，
//     同一份只 commit 一次（commitSent 本身一天內重複呼叫也沒關係，見 ALMNC-47）。
//   - 產生失敗就不推：Rust 繼續送還在當天有效的舊內容，沒有就回 503，電子紙沿用舊檔。
import type { Briefing } from '@/lib/eink/briefing/types'
import type { LanDownloadedEvent, LanPublishInput } from './bridge'
import { nextLocalMidnight } from './urls'

export interface LanContent {
  /** YYYY-MM-DD */
  date: string
  briefing: Briefing
  /** 比對「當天資料有沒有變」用的鍵（預設是 Briefing 的 JSON） */
  briefingKey: string
  sleep: Uint8Array
  /** OPDS 顯示的書名，例如「今日簡報 2026-11-21」 */
  title: string
  /** 需要時才產生 EPUB（要抓圖片，比較慢） */
  makeEpub: () => Promise<Uint8Array>
}

export interface PublisherDeps {
  load: (now: Date) => Promise<LanContent>
  publish: (input: LanPublishInput) => Promise<void>
  commit: (briefing: Briefing) => Promise<void>
  hash: (bytes: Uint8Array) => Promise<string>
  now?: () => Date
  /** 背景定時重算的間隔；0 表示不定時 */
  intervalMs?: number
  report?: (message: string) => void
}

export interface LanPublisher {
  start: () => void
  stop: () => void
  /** 重算並推送（同時有好幾個請求時合併成一次） */
  refresh: () => Promise<void>
  onDownloaded: (event: LanDownloadedEvent) => Promise<void>
}

const MAX_REMEMBERED = 20

export function createLanPublisher(deps: PublisherDeps): LanPublisher {
  const now = deps.now ?? (() => new Date())
  const report = deps.report ?? ((message: string) => console.warn(`[eink-lan] ${message}`))
  let lastEpub: { date: string, briefingKey: string, bytes: Uint8Array, hash: string } | null = null
  const briefingByHash = new Map<string, Briefing>()
  const committed = new Set<string>()
  let running: Promise<void> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function remember(hash: string, briefing: Briefing) {
    briefingByHash.delete(hash)
    briefingByHash.set(hash, briefing)
    while (briefingByHash.size > MAX_REMEMBERED) {
      const oldest = briefingByHash.keys().next().value
      if (oldest === undefined) break
      briefingByHash.delete(oldest)
      committed.delete(oldest)
    }
  }

  async function run() {
    const at = now()
    const content = await deps.load(at)
    const validUntil = nextLocalMidnight(at)
    await deps.publish({
      kind: 'sleep', date: content.date, hash: await deps.hash(content.sleep), title: content.title, validUntil, bytes: content.sleep,
    })
    let epub = lastEpub
    if (!epub || epub.date !== content.date || epub.briefingKey !== content.briefingKey) {
      const bytes = await content.makeEpub()
      epub = { date: content.date, briefingKey: content.briefingKey, bytes, hash: await deps.hash(bytes) }
    }
    remember(epub.hash, content.briefing)
    await deps.publish({ kind: 'epub', date: content.date, hash: epub.hash, title: content.title, validUntil, bytes: epub.bytes })
    lastEpub = epub
  }

  function refresh(): Promise<void> {
    running ??= run()
      .catch(error => report(`refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`))
      .finally(() => { running = null })
    return running
  }

  async function onDownloaded(event: LanDownloadedEvent) {
    if (event.kind !== 'epub' || committed.has(event.hash)) return
    const briefing = briefingByHash.get(event.hash)
    if (!briefing || briefing.date !== event.date) return
    committed.add(event.hash)
    try {
      await deps.commit(briefing)
    } catch (error) {
      committed.delete(event.hash)
      report(`commit failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  return {
    start() {
      void refresh()
      const interval = deps.intervalMs ?? 30 * 60_000
      if (interval > 0 && !timer) timer = setInterval(() => { void refresh() }, interval)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    refresh,
    onDownloaded,
  }
}

/** app 內：讀今天的簡報，畫休眠畫面；EPUB 等到需要時才做。 */
export async function loadLanContent(at: Date): Promise<LanContent> {
  const [{ buildBriefing }, { loadBriefingTexts }, { loadSleepTexts }, epubTexts, epub, sleep] = await Promise.all([
    import('@/lib/eink/briefing'), import('@/lib/eink/briefing/texts'), import('@/lib/eink/sleep/texts'),
    import('@/lib/eink/epub/texts'), import('@/lib/eink/epub'), import('@/lib/eink/sleep'),
  ])
  const briefingTexts = await loadBriefingTexts()
  const [briefing, texts, { texts: bookTexts, locale }] = await Promise.all([
    buildBriefing(at, undefined, briefingTexts), loadSleepTexts(), epubTexts.loadEpubTexts(),
  ])
  const options = { texts: bookTexts, locale, dayParts: briefingTexts.dayParts }
  // 頁數用不抓圖的 EPUB 估（跟 buildTodaySleepBmp 一樣）
  const pages = epub.fitBriefingEpub(briefing, new Map(), { ...options, generatedAt: at.getTime() }).pages
  const bmp = await sleep.buildSleepBmp(briefing, { updatedAt: at.getTime(), texts, briefingPages: pages })
  return {
    date: briefing.date,
    briefing,
    briefingKey: JSON.stringify(briefing),
    sleep: bmp.bytes,
    title: epubTexts.fill(bookTexts.bookTitle, { date: briefing.date }),
    makeEpub: async () => (await epub.buildBriefingEpub(briefing, options)).bytes,
  }
}
