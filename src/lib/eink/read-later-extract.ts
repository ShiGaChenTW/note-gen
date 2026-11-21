// Fork（almanac ALMNC-46）：稍後讀文章的擷取。抓網頁與抽正文沿用 web-capture（Tauri http 外掛＋Readability），
// 這裡只判斷結果能不能放進今日簡報：成功才留正文；付費牆、只有摘要、連不上、被擋都標成無法擷取。
import type { WebCaptureResult } from '@/lib/web-capture/types'
import type { ExtractionOutcome, ReadLaterFailure } from './read-later'

/** 結構化資料明白寫著「非免費」：最可靠的付費牆訊號。 */
const PAYWALL_JSON_LD = /"isAccessibleForFree"\s*:\s*(?:false|"false")/i
/** 版面上的付費牆元素或文案；只在正文不完整時採信（有些網站全文頁也留著付費牆元件）。 */
const PAYWALL_MARKERS = [
  /<[^>]+(?:class|id)\s*=\s*["'][^"']*\b(?:paywall|premium-content|subscriber-only|meter-wall|piano-offer)\b/i,
  /\bdata-paywall\b/i,
  /subscribe (?:now )?to (?:continue|keep) reading|subscribers? only|this (?:article|story) is (?:only )?(?:available )?(?:for|to) subscribers/i,
  /訂閱(?:後|即可)?(?:繼續)?(?:閱讀|觀看)全文|付費(?:會員|訂閱)(?:才能|專屬)|成為會員.{0,10}閱讀全文|登入(?:後)?(?:即可)?閱讀全文|本文(?:為|屬於)付費/,
  /订阅(?:后|即可)?(?:继续)?阅读全文|付费(?:会员|订阅)(?:才能|专属)|登录(?:后)?阅读全文/,
]

export function detectPaywall(html: string): 'strong' | 'weak' | null {
  if (PAYWALL_JSON_LD.test(html)) return 'strong'
  return PAYWALL_MARKERS.some(pattern => pattern.test(html)) ? 'weak' : null
}

function failure(reason: ReadLaterFailure, capture: WebCaptureResult): ExtractionOutcome {
  const title = capture.title && capture.title !== safeHostname(capture.finalUrl) ? capture.title : undefined
  return title ? { ok: false, reason, title } : { ok: false, reason }
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

/** 把 web-capture 的結果分成「可放進簡報」或「無法擷取＋原因」。html 是抓到的原文（判斷付費牆用，可省略）。 */
export function classifyCapture(capture: WebCaptureResult, html?: string): ExtractionOutcome {
  const paywall = html ? detectPaywall(html) : null
  switch (capture.status) {
    case 'success':
      if (paywall === 'strong') return failure('paywall', capture)
      return {
        ok: true,
        title: capture.title,
        ...(capture.byline ? { author: capture.byline } : {}),
        content: capture.contentMarkdown,
        images: [...(capture.imageUrls ?? [])],
      }
    case 'partial':
    case 'metadata-only':
      return failure(paywall ? 'paywall' : 'summary-only', capture)
    case 'blocked':
      return failure(capture.errorCode === 'login-required' || paywall ? 'paywall' : 'blocked', capture)
    case 'failed':
    default:
      return failure(
        capture.errorCode === 'unsupported-content' || capture.errorCode === 'content-too-large' ? 'unsupported' : 'unreachable',
        capture,
      )
  }
}

/** 從已經拿到的 HTML 擷取（測試用存好的範例，不連外網）。 */
export async function extractArticleFromHtml(html: string, url: string): Promise<ExtractionOutcome> {
  const { extractWebPage } = await import('@/lib/web-capture/extract')
  return classifyCapture(extractWebPage(html, url, url), html)
}

/** 實際抓網頁並擷取（Tauri http 外掛；只收公開的 http(s) 網址）。 */
export async function captureReadLaterArticle(url: string): Promise<ExtractionOutcome> {
  const { capturePublicWebPage } = await import('@/lib/web-capture/service')
  let html: string | undefined
  const capture = await capturePublicWebPage(url, { onHtml: value => { html = value } })
  return classifyCapture(capture, html)
}
