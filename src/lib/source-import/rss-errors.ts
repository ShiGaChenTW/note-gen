// Fork（almanac ALMNC-57.2）：RSS 訂閱失敗的說明文字（設定頁與新增資料源對話框共用）。t 是 settings.rss 底下的翻譯。
import type { RssErrorCode, RssFeed } from './rss-feeds'
import { toRssError, type RefreshResult } from './rss-scheduler'

type Translate = (key: string, values?: Record<string, string | number>) => string

/** 已經訂閱過同一個 feed 網址。 */
export class DuplicateFeedError extends Error {
  readonly code = 'duplicate'
  constructor(readonly feed: RssFeed) {
    super('already subscribed')
    this.name = 'DuplicateFeedError'
  }
}

/** 錯誤碼 → 依語系的說明。 */
export function rssErrorText(t: Translate, error: { code: RssErrorCode, detail?: string }): string {
  return t(`errors.${error.code}`, { detail: error.detail ?? '' })
}

/** 訂閱失敗時的提示文字（重複訂閱、網址不對、不是 feed、連不上…）。 */
export function rssSubscribeErrorText(t: Translate, error: unknown): string {
  if (error instanceof DuplicateFeedError) return t('duplicate', { name: error.feed.name })
  return rssErrorText(t, toRssError(error))
}

/** 「立即更新」的結果提示。 */
export function rssRefreshText(t: Translate, results: readonly RefreshResult[]): string {
  const added = results.reduce((sum, result) => sum + result.added, 0)
  const failed = results.filter(result => !result.ok).length
  return failed ? t('refreshedWithErrors', { count: added, failed }) : t('refreshed', { count: added })
}
