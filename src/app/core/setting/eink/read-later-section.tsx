'use client'

// Fork（almanac ALMNC-46）：稍後讀清單的管理（設定 > 電子紙底下）。可以看、移除、把已送電子紙的放回待送、重新擷取。
// 「加入連結」只是清單管理用的最小入口；Q17（文章平常怎麼放進清單）還沒定案，定案的入口呼叫 addToReadLater(url)。
import { useEffect, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link2, LoaderCircle, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { SettingSection } from '../components/setting-base'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import type { ReadLaterItem } from '@/lib/eink/read-later'
import useReadLaterStore from '@/stores/read-later'

function statusKey(item: ReadLaterItem): 'pending' | 'extracting' | 'sent' | 'unextractable' {
  if (item.status === 'pending' && item.extractedAt === undefined) return 'extracting'
  return item.status
}

export function ReadLaterSection() {
  const t = useTranslations('settings.eink.readLater')
  const locale = useLocale()
  const items = useReadLaterStore(state => state.items)
  const loaded = useReadLaterStore(state => state.loaded)
  const extracting = useReadLaterStore(state => state.extracting)
  const [url, setUrl] = useState('')

  // 打開清單時讀檔，並把上次沒擷取完的接著擷取
  useEffect(() => {
    const store = useReadLaterStore.getState()
    void store.init().then(() => store.extract())
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!url.trim()) return
    const result = await useReadLaterStore.getState().add(url)
    if (result === 'added') {
      setUrl('')
      toast.success(t('added'))
    } else if (result === 'duplicate') {
      toast.info(t('duplicate'))
    } else {
      toast.error(t('invalid'))
    }
  }

  const date = (ms: number) => new Date(ms).toLocaleDateString(locale)
  const newestFirst = [...items].reverse()

  return (
    <SettingSection title={t('title')} desc={t('desc')}>
      <form className="flex gap-2" onSubmit={event => void submit(event)}>
        <Input
          value={url}
          type="url"
          inputMode="url"
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          onChange={event => setUrl(event.target.value)}
        />
        <Button type="submit" disabled={!url.trim()}><Link2 />{t('add')}</Button>
      </form>
      {loaded && items.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : null}
      {items.length > 0 ? (
        <ItemGroup className="gap-2" data-testid="eink-read-later">
          {newestFirst.map(item => {
            const status = statusKey(item)
            let host = item.url
            try { host = new URL(item.url).hostname } catch { /* 保留原網址 */ }
            return (
              <Item key={item.url} variant="outline" size="sm" data-status={status}>
                <ItemMedia variant="icon">
                  {status === 'extracting' && extracting ? <LoaderCircle className="animate-spin" /> : <Link2 />}
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full min-w-0">
                    <span className="truncate">{item.title || host}</span>
                    <Badge variant={status === 'unextractable' ? 'destructive' : status === 'sent' ? 'secondary' : 'outline'} className="shrink-0">
                      {t(`status.${status}`)}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription className="truncate">
                    {[
                      item.author,
                      host,
                      t('addedAt', { date: date(item.addedAt) }),
                      item.sentAt ? t('sentAt', { date: date(item.sentAt) }) : null,
                      item.error ? t(`failure.${item.error}`) : null,
                    ].filter(Boolean).join(' · ')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {item.status === 'sent' ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void useReadLaterStore.getState().requeue(item.url)}>
                      <RotateCcw />{t('requeue')}
                    </Button>
                  ) : null}
                  {item.status === 'unextractable' ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void useReadLaterStore.getState().retry(item.url)}>
                      <RefreshCw />{t('retry')}
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="icon" aria-label={t('remove')} title={t('remove')} onClick={() => void useReadLaterStore.getState().remove(item.url)}>
                    <Trash2 />
                  </Button>
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      ) : null}
    </SettingSection>
  )
}
