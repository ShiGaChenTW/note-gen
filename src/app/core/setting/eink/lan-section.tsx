'use client'

// Fork（almanac ALMNC-50）：設定 > 電子紙 > 區網服務打開後顯示：埠、服務狀態、要填進電子紙的網址。
// 網址裡的 token 預設遮住，複製時才給完整的；不印進 log。服務本身由 src/lib/eink/lan/service.ts 依設定開關。
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookOpen, Copy, Image as ImageIcon, Network } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { normalizeLanPort } from '@/lib/eink/settings'
import { useEinkLanStatus } from '@/lib/eink/lan/service'
import { LAN_OPDS_USER, lanOpdsUrl, lanServerBase, lanSleepUrl, redactToken } from '@/lib/eink/lan/urls'
import useEinkStore from '@/stores/eink'

async function copy(value: string, done: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(done)
  } catch {
    // 複製失敗不提示內容（可能含 token）
  }
}

export function LanServerDetails() {
  const t = useTranslations('settings.eink.lan')
  const settings = useEinkStore(state => state.settings)
  const token = useEinkStore(state => state.token)
  const updateSettings = useEinkStore(state => state.updateSettings)
  const status = useEinkLanStatus(state => state.status)
  const refreshStatus = useEinkLanStatus(state => state.refreshStatus)
  const [port, setPort] = useState(String(settings.lanPort))
  useEffect(() => setPort(String(settings.lanPort)), [settings.lanPort])
  useEffect(() => {
    void refreshStatus()
    const timer = setInterval(() => { void refreshStatus() }, 10_000)
    return () => clearInterval(timer)
  }, [refreshStatus])

  const parsedPort = normalizeLanPort(port)
  async function commitPort() {
    if (parsedPort === null || parsedPort === settings.lanPort) return
    await updateSettings({ lanPort: parsedPort })
  }

  const enabled = settings.enabled
  const base = status?.running && status.address ? lanServerBase(status.address) : null
  const ipChanged = !!(status?.running && status.address && status.lanIp && !status.address.startsWith(`${status.lanIp}:`))
  const statusText = !enabled
    ? t('status.needsEnabled')
    : status?.error
      ? t('status.error', { error: status.error })
      : base
        ? t('status.running', { address: status?.address ?? '' })
        : t('status.stopped')
  const sleepUrl = base ? lanSleepUrl(base, token) : ''
  const opdsUrl = base ? lanOpdsUrl(base) : ''

  return (
    <>
      <Item variant="outline" data-testid="eink-lan-details">
        <ItemMedia variant="icon"><Network /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('port.title')}</ItemTitle>
          <ItemDescription>{parsedPort === null ? t('port.invalid') : statusText}</ItemDescription>
          {ipChanged ? <ItemDescription className="text-amber-600">{t('status.ipChanged', { ip: status?.lanIp ?? '' })}</ItemDescription> : null}
        </ItemContent>
        <ItemActions>
          <Input
            className="w-28"
            inputMode="numeric"
            value={port}
            aria-label={t('port.title')}
            aria-invalid={parsedPort === null || undefined}
            onChange={event => setPort(event.target.value)}
            onBlur={() => void commitPort()}
            onKeyDown={event => { if (event.key === 'Enter') void commitPort() }}
          />
        </ItemActions>
      </Item>
      {base ? (
        <>
          <Item variant="outline">
            <ItemMedia variant="icon"><ImageIcon /></ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>{t('sleepUrl.title')}</ItemTitle>
              <ItemDescription>{t('sleepUrl.desc')}</ItemDescription>
              <code data-testid="eink-lan-sleep-url" className="mt-1 break-all font-mono text-xs text-muted-foreground">{redactToken(sleepUrl, token)}</code>
            </ItemContent>
            <ItemActions>
              <Button type="button" variant="outline" onClick={() => void copy(sleepUrl, t('copied'))}><Copy />{t('copy')}</Button>
            </ItemActions>
          </Item>
          <Item variant="outline">
            <ItemMedia variant="icon"><BookOpen /></ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>{t('opds.title')}</ItemTitle>
              <ItemDescription>{t('opds.desc', { user: LAN_OPDS_USER })}</ItemDescription>
              <code data-testid="eink-lan-opds-url" className="mt-1 break-all font-mono text-xs text-muted-foreground">{opdsUrl}</code>
            </ItemContent>
            <ItemActions>
              <Button type="button" variant="outline" onClick={() => void copy(opdsUrl, t('copied'))}><Copy />{t('copy')}</Button>
              <Button type="button" variant="ghost" onClick={() => void copy(token, t('copied'))}>{t('opds.copyPassword')}</Button>
            </ItemActions>
          </Item>
        </>
      ) : null}
    </>
  )
}
