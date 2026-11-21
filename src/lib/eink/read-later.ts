// Fork（almanac ALMNC-46）：稍後讀清單。純函式，存在 store.json 的 einkReadLater。
// 稍後讀清單（GLOSSARY）＝Scott 存下、還沒送進今日簡報的文章連結；每日精選文章只從這裡取。
// 狀態流轉：
//   加入 → 待送（pending，尚未擷取）
//   擷取成功 → 仍是待送，帶正文（今日簡報可取用）
//   擷取失敗（付費牆、只有摘要、連不上…）→ 無法擷取（unextractable），不送進簡報、不擋其他文章
//   真的送到電子紙 → 已送電子紙（sent）；可手動放回待送
//   無法擷取 → 可重新擷取（回到待送、清掉錯誤）
// 怎麼把文章放進清單（Q17：資料源、分享選單、瀏覽器擴充…）還沒定案；入口只要呼叫 addToReadLater(url)。

export type ReadLaterStatus = 'pending' | 'sent' | 'unextractable'

/** 無法擷取的原因 */
export type ReadLaterFailure = 'paywall' | 'summary-only' | 'unreachable' | 'blocked' | 'unsupported'

export interface ReadLaterItem {
  /** 正規化後的網址，也是去重用的鍵 */
  url: string
  addedAt: number
  status: ReadLaterStatus
  title?: string
  author?: string
  /** 擷取到的正文（Markdown），給今日簡報用 */
  content?: string
  /** 正文裡的圖片網址（絕對網址），之後由 EPUB 產生器下載、縮圖 */
  images?: string[]
  extractedAt?: number
  /** 送到電子紙的時間 */
  sentAt?: number
  error?: ReadLaterFailure
}

export type ExtractionOutcome =
  | { ok: true, title: string, author?: string, content: string, images: string[] }
  | { ok: false, reason: ReadLaterFailure, title?: string }

export const EINK_READ_LATER_KEY = 'einkReadLater'
export const READ_LATER_FAILURES: readonly ReadLaterFailure[] = ['paywall', 'summary-only', 'unreachable', 'blocked', 'unsupported']
/** 每日精選文章一天取幾篇（計畫 v2：3 篇、最早存的先送）。 */
export const DAILY_ARTICLE_COUNT = 3

const TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_(?:cid|eid)$/i, /^igshid$/i, /^spm$/i, /^share_/i, /^ref_src$/i]

/**
 * 網址正規化（去重用）：只收 http(s)；主機轉小寫、去掉預設埠、#片段、追蹤參數與路徑結尾斜線。
 * 不是合法網址回傳 null。
 */
export function normalizeReadLaterUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname || !url.hostname.includes('.') && url.hostname !== 'localhost') return null
  url.hash = ''
  url.username = ''
  url.password = ''
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some(pattern => pattern.test(key))) url.searchParams.delete(key)
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.href
}

function isFailure(value: unknown): value is ReadLaterFailure {
  return typeof value === 'string' && (READ_LATER_FAILURES as readonly string[]).includes(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 讀回清單：丟掉壞資料、重複網址（保留先存的），依存入時間排序。 */
export function normalizeReadLater(saved: unknown): ReadLaterItem[] {
  if (!Array.isArray(saved)) return []
  const seen = new Set<string>()
  const out: ReadLaterItem[] = []
  for (const raw of saved) {
    if (!raw || typeof raw !== 'object') continue
    const value = raw as Record<string, unknown>
    if (typeof value.url !== 'string' || typeof value.addedAt !== 'number') continue
    const url = normalizeReadLaterUrl(value.url)
    if (!url || seen.has(url)) continue
    const status: ReadLaterStatus = value.status === 'sent' || value.status === 'unextractable' ? value.status : 'pending'
    seen.add(url)
    out.push({
      url,
      addedAt: value.addedAt,
      status,
      title: optionalString(value.title),
      author: optionalString(value.author),
      content: optionalString(value.content),
      images: Array.isArray(value.images) ? value.images.filter((image): image is string => typeof image === 'string') : undefined,
      extractedAt: optionalNumber(value.extractedAt),
      sentAt: optionalNumber(value.sentAt),
      error: status === 'unextractable' ? (isFailure(value.error) ? value.error : 'unreachable') : undefined,
    })
  }
  return sortByAdded(out.map(stripUndefined))
}

function stripUndefined(item: ReadLaterItem): ReadLaterItem {
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)) as unknown as ReadLaterItem
}

function sortByAdded(items: ReadLaterItem[]): ReadLaterItem[] {
  return [...items].sort((a, b) => a.addedAt - b.addedAt)
}

export type AddResult =
  | { result: 'added', items: ReadLaterItem[], url: string }
  | { result: 'duplicate', items: ReadLaterItem[], url: string }
  | { result: 'invalid', items: ReadLaterItem[] }

/** 加入一個連結；同一網址（正規化後）不重複加入。 */
export function addReadLater(items: readonly ReadLaterItem[], value: string, now: number): AddResult {
  const url = normalizeReadLaterUrl(value)
  if (!url) return { result: 'invalid', items: [...items] }
  if (items.some(item => item.url === url)) return { result: 'duplicate', items: [...items], url }
  return { result: 'added', items: sortByAdded([...items, { url, addedAt: now, status: 'pending' }]), url }
}

export function removeReadLater(items: readonly ReadLaterItem[], url: string): ReadLaterItem[] {
  return items.filter(item => item.url !== url)
}

/** 待送且還沒擷取過的文章要去抓。 */
export function needsExtraction(item: ReadLaterItem): boolean {
  return item.status === 'pending' && item.extractedAt === undefined
}

/**
 * 套用擷取結果。只動仍在等擷取的那則（期間被移除或已送出就不動）。
 * 成功：仍是待送、存下正文；失敗：標成無法擷取並記原因。
 */
export function applyExtraction(items: readonly ReadLaterItem[], url: string, outcome: ExtractionOutcome, now: number): ReadLaterItem[] {
  return items.map(item => {
    if (item.url !== url || !needsExtraction(item)) return item
    if (outcome.ok) {
      return stripUndefined({
        url: item.url,
        addedAt: item.addedAt,
        status: 'pending',
        title: outcome.title || undefined,
        author: outcome.author || undefined,
        content: outcome.content,
        images: [...outcome.images],
        extractedAt: now,
      })
    }
    return stripUndefined({
      url: item.url,
      addedAt: item.addedAt,
      status: 'unextractable',
      title: outcome.title || item.title,
      extractedAt: now,
      error: outcome.reason,
    })
  })
}

/** 真的送到電子紙後（區網下載成功或立即推送）：待送且有正文的移到已送電子紙。 */
export function markReadLaterSent(items: readonly ReadLaterItem[], urls: readonly string[], at: number): ReadLaterItem[] {
  const sent = new Set(urls)
  return items.map(item => (sent.has(item.url) && isBriefingCandidate(item) ? { ...item, status: 'sent', sentAt: at } : item))
}

/** 已送電子紙的放回待送（保留已擷取的正文）。 */
export function requeueReadLater(items: readonly ReadLaterItem[], url: string): ReadLaterItem[] {
  return items.map(item => {
    if (item.url !== url || item.status !== 'sent') return item
    return stripUndefined({ ...item, status: 'pending', sentAt: undefined })
  })
}

/** 無法擷取的重新擷取：回到待送、清掉原因與擷取時間，下一輪會再抓一次。 */
export function retryReadLater(items: readonly ReadLaterItem[], url: string): ReadLaterItem[] {
  return items.map(item => {
    if (item.url !== url || item.status !== 'unextractable') return item
    return stripUndefined({ ...item, status: 'pending', error: undefined, extractedAt: undefined })
  })
}

/** 可以送進今日簡報的文章：待送、已擷取且有正文。無法擷取與還沒擷取的都不算。 */
export function isBriefingCandidate(item: ReadLaterItem): boolean {
  return item.status === 'pending' && item.extractedAt !== undefined && Boolean(item.content?.trim())
}

/** 今天的每日精選文章：最早存的先送，最多 limit 篇；清單空了就回傳空陣列（整章拿掉）。 */
export function pickDailyArticles(items: readonly ReadLaterItem[], limit = DAILY_ARTICLE_COUNT): ReadLaterItem[] {
  return sortByAdded(items.filter(isBriefingCandidate)).slice(0, Math.max(0, limit))
}

/**
 * 依序擷取所有待擷取的文章：一次一篇，某篇失敗（包括擷取函式自己丟錯）只標那篇，不擋其他篇。
 * onUpdate 每篇做完就收到最新清單（給 store 存檔）；getItems 讓呼叫端在每篇之間拿到最新狀態（使用者可能刪了某篇）。
 */
export async function extractPending(
  getItems: () => readonly ReadLaterItem[],
  extract: (url: string) => Promise<ExtractionOutcome>,
  onUpdate: (items: ReadLaterItem[]) => void | Promise<void>,
  now: () => number = Date.now,
): Promise<void> {
  const tried = new Set<string>()
  for (;;) {
    const next = getItems().find(item => needsExtraction(item) && !tried.has(item.url))
    if (!next) return
    tried.add(next.url)
    let outcome: ExtractionOutcome
    try {
      outcome = await extract(next.url)
    } catch {
      outcome = { ok: false, reason: 'unreachable' }
    }
    await onUpdate(applyExtraction(getItems(), next.url, outcome, now()))
  }
}
