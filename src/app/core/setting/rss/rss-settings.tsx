'use client'

// Fork（almanac ALMNC-57.2）：設定裡的「RSS 訂閱」（只在 V3）：新增、命名、暫停、刪除、立即更新；每個訂閱顯示上次更新或上次錯誤與時間。
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUiV3 } from '@/lib/fork-ui'
import { formatDateTime } from '@/lib/source-import/text'
import type { RssFeed } from '@/lib/source-import/rss-feeds'
import { toRssError } from '@/lib/source-import/rss-scheduler'
import { rssErrorText, rssRefreshText, rssSubscribeErrorText } from '@/lib/source-import/rss-errors'
import useRssStore from '@/lib/source-import/rss-store'
import { SettingSection } from '../components/setting-base'

function FeedStatus({ feed }: { feed: RssFeed }) {
  const t = useTranslations('settings.rss')
  if (feed.lastError && feed.lastErrorAt !== undefined) {
    return (
      <p className="text-xs text-destructive">
        {t('lastError', { time: formatDateTime(feed.lastErrorAt), message: rssErrorText(t, { code: feed.lastError, detail: feed.lastErrorDetail }) })}
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      {feed.lastSuccessAt !== undefined ? t('lastFetched', { time: formatDateTime(feed.lastSuccessAt), count: feed.lastAdded ?? 0 }) : t('never')}
    </p>
  )
}

function FeedRow({ feed, disabled }: { feed: RssFeed, disabled: boolean }) {
  const t = useTranslations('settings.rss')
  const [name, setName] = useState(feed.name)
  useEffect(() => setName(feed.name), [feed.name])
  const store = useRssStore.getState()

  async function commitName() {
    const next = name.trim()
    if (!next || next === feed.name) {
      setName(feed.name)
      return
    }
    await store.rename(feed.id, next).catch(() => toast.error(t('loadError')))
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1">
        <Input
          className="h-8"
          value={name}
          aria-label={t('renameLabel', { name: feed.name })}
          disabled={disabled}
          onChange={event => setName(event.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void commitName() }}
        />
        <p className="break-all text-xs text-muted-foreground">
          {feed.url}{feed.paused && <> · {t('paused')}</>}
        </p>
        <FeedStatus feed={feed} />
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void store.setPaused(feed.id, !feed.paused)}>
          {t(feed.paused ? 'resume' : 'pause')}<span className="sr-only"> {feed.name}</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void store.remove(feed.id).then(() => toast.success(t('deleted', { name: feed.name })))}
        >
          {t('delete')}<span className="sr-only"> {feed.name}</span>
        </Button>
      </div>
    </li>
  )
}

export function RssSettings() {
  const v3 = useUiV3()
  return v3 ? <RssSettingsPanel /> : null
}

function RssSettingsPanel() {
  const t = useTranslations('settings.rss')
  const feeds = useRssStore(state => state.feeds)
  const ready = useRssStore(state => state.ready)
  const refreshing = useRssStore(state => state.refreshing)
  const [loadError, setLoadError] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [subscribing, setSubscribing] = useState(false)

  useEffect(() => {
    void useRssStore.getState().load().catch(error => {
      console.error('[rss] subscriptions load failed', error)
      setLoadError(true)
    })
  }, [])

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (subscribing || !url.trim()) return
    setSubscribing(true)
    try {
      const { feed, result } = await useRssStore.getState().subscribe({ url, name })
      setUrl('')
      setName('')
      if (result.ok) toast.success(t('subscribed', { name: feed.name, count: result.added }))
      else toast.error(rssErrorText(t, result.error ?? { code: 'unknown' }))
    } catch (error) {
      toast.error(rssSubscribeErrorText(t, error))
    } finally {
      setSubscribing(false)
    }
  }

  async function refreshAll() {
    try {
      toast.success(rssRefreshText(t, await useRssStore.getState().refreshNow()))
    } catch (error) {
      toast.error(rssErrorText(t, toRssError(error)))
    }
  }

  const busy = subscribing || refreshing
  return (
    <SettingSection title={t('title')} desc={t('desc')}>
      <div className="space-y-3 text-sm text-ink">
        {loadError && <p role="alert">{t('loadError')}</p>}
        {!ready && !loadError && <p role="status">{t('loading')}</p>}
        <form onSubmit={event => void subscribe(event)} className="flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-[2] space-y-1">
            <span>{t('urlLabel')}</span>
            <Input type="url" inputMode="url" value={url} placeholder={t('urlPlaceholder')} disabled={!ready || subscribing} onChange={event => setUrl(event.target.value)} />
          </label>
          <label className="min-w-40 flex-1 space-y-1">
            <span>{t('nameLabel')}</span>
            <Input value={name} maxLength={80} placeholder={t('namePlaceholder')} disabled={!ready || subscribing} onChange={event => setName(event.target.value)} />
          </label>
          <Button type="submit" disabled={!ready || subscribing || !url.trim()}>{t(subscribing ? 'subscribing' : 'subscribe')}</Button>
        </form>
        {ready && feeds.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
        {feeds.length > 0 && (
          <>
            <ul className="divide-y divide-line rounded-md border border-line bg-panel">
              {feeds.map(feed => <FeedRow key={feed.id} feed={feed} disabled={busy} />)}
            </ul>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void refreshAll()}>
              {t(refreshing ? 'refreshing' : 'refreshNow')}
            </Button>
          </>
        )}
      </div>
    </SettingSection>
  )
}
