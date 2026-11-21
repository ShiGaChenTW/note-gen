// @vitest-environment jsdom
// almanac ALMNC-46：用存好的 HTML 範例擷取（不連外網）；付費牆、只有摘要、連不上都標成無法擷取。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WebCaptureResult } from '@/lib/web-capture/types'
import { classifyCapture, detectPaywall, extractArticleFromHtml } from './read-later-extract'

const fixture = (name: string) => readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')

function capture(over: Partial<WebCaptureResult>): WebCaptureResult {
  return {
    requestedUrl: 'https://example.com/a', finalUrl: 'https://example.com/a', title: 'example.com',
    contentMarkdown: '', plainText: '', method: 'http', status: 'failed', qualityScore: 0, capturedAt: 0, ...over,
  }
}

describe('extractArticleFromHtml（存好的範例）', () => {
  it('完整文章：取得標題、作者、正文與圖片（絕對網址）', async () => {
    const outcome = await extractArticleFromHtml(fixture('article.html'), 'https://weekly.example.com/eink')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.title).toBe('為什麼電子紙適合深度閱讀')
    expect(outcome.author).toBe('林小雨')
    expect(outcome.content).toContain('電子紙不會自己發光')
    expect(outcome.content).toContain('最後，閱讀是一種需要練習的能力')
    expect(outcome.content).not.toContain('首頁')
    expect(outcome.images).toEqual(['https://weekly.example.com/images/eink-desk.jpg'])
  })

  it('付費牆（結構化資料寫著非免費）→ 無法擷取／paywall', async () => {
    expect(await extractArticleFromHtml(fixture('paywall.html'), 'https://times.example.com/n')).toEqual({
      ok: false, reason: 'paywall', title: 'The Hidden Cost of Notifications',
    })
  })

  it('付費牆（版面元素＋只有開頭一段）→ 無法擷取／paywall', async () => {
    const outcome = await extractArticleFromHtml(fixture('paywall-marker.html'), 'https://daily.example.com/q')
    expect(outcome).toMatchObject({ ok: false, reason: 'paywall' })
  })

  it('只有摘要 → 無法擷取／summary-only', async () => {
    const outcome = await extractArticleFromHtml(fixture('summary-only.html'), 'https://blog.example.com/w')
    expect(outcome).toMatchObject({ ok: false, reason: 'summary-only' })
  })
})

describe('classifyCapture', () => {
  it('連不上、逾時、HTTP 錯誤 → unreachable', () => {
    for (const errorCode of ['network', 'timeout', 'http-error', 'invalid-url', 'redirect-limit'] as const) {
      expect(classifyCapture(capture({ status: 'failed', errorCode }))).toEqual({ ok: false, reason: 'unreachable' })
    }
  })

  it('需要登入 → paywall；驗證碼或拒絕存取 → blocked；不是網頁 → unsupported', () => {
    expect(classifyCapture(capture({ status: 'blocked', errorCode: 'login-required' }))).toMatchObject({ reason: 'paywall' })
    expect(classifyCapture(capture({ status: 'blocked', errorCode: 'captcha' }))).toMatchObject({ reason: 'blocked' })
    expect(classifyCapture(capture({ status: 'failed', errorCode: 'unsupported-content' }))).toMatchObject({ reason: 'unsupported' })
  })

  it('成功但頁面上有付費牆元件時仍採用全文（只有結構化資料才算數）', () => {
    const ok = capture({ status: 'success', title: 'T', contentMarkdown: 'body', imageUrls: [] })
    expect(classifyCapture(ok, '<div class="paywall"></div>')).toMatchObject({ ok: true, content: 'body' })
    expect(classifyCapture(ok, '{"isAccessibleForFree": false}')).toMatchObject({ ok: false, reason: 'paywall' })
  })

  it('detectPaywall 分強弱', () => {
    expect(detectPaywall('"isAccessibleForFree":"false"')).toBe('strong')
    expect(detectPaywall('<p>訂閱後閱讀全文</p>')).toBe('weak')
    expect(detectPaywall('<p>hello</p>')).toBeNull()
  })
})
