'use client'

// Fork（almanac ALMNC-52）：設定 > 電子紙 > 安裝到電子紙。照步驟一次裝好外掛（含伺服器網址與 token）、
// 可選的中文字型、OPDS 書目；另有「立即推送」直接上傳今日簡報與休眠畫面（外掛抓不到時用）。
// 偵測只在按下「偵測閱讀器」時才發請求（AC #4）；安裝與推送也都要先偵測到閱讀器才能按。
import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Search, Send, Type } from 'lucide-react'
import { toast } from 'sonner'
import { SettingSection } from '../components/setting-base'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import type { DeviceStatus } from '@/lib/eink/device/client'
import { deviceHttp } from '@/lib/eink/device/http'
import { isValidFontFileName } from '@/lib/eink/device/paths'
import { detectReader, installToReader, pushNow, type FontFile } from '@/lib/eink/device/plan'
import { useEinkLanStatus } from '@/lib/eink/lan/service'
import { lanServerBase } from '@/lib/eink/lan/urls'
import useEinkStore from '@/stores/eink'

const STEPS = ['fileTransfer', 'address', 'detect', 'install', 'readerSettings'] as const

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

export function ReaderSection() {
  const t = useTranslations('settings.eink.reader')
  const settings = useEinkStore(state => state.settings)
  const token = useEinkStore(state => state.token)
  const lan = useEinkLanStatus(state => state.status)
  const [detected, setDetected] = useState<DeviceStatus | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'detect' | 'install' | 'push' | null>(null)
  const [includeBriefing, setIncludeBriefing] = useState(false)
  const [font, setFont] = useState<FontFile | null>(null)
  const fontInput = useRef<HTMLInputElement>(null)

  const reader = settings.readerAddress
  const server = lan?.running && lan.address ? lanServerBase(lan.address) : null

  async function detect() {
    if (!reader) return
    setBusy('detect')
    setDetectError(null)
    try {
      setDetected(await detectReader(deviceHttp(), reader))
    } catch (error) {
      setDetected(null)
      setDetectError(message(error))
    } finally {
      setBusy(null)
    }
  }

  async function install() {
    if (!reader || !server || !detected) return
    setBusy('install')
    try {
      const { loadPluginTemplates } = await import('@/lib/eink/plugin/files')
      const report = await installToReader(deviceHttp(), reader, await loadPluginTemplates(), { server, token, includeBriefing, font })
      toast.success(t('install.done', { count: report.written.length }))
    } catch (error) {
      toast.error(t('install.failed', { error: message(error) }))
    } finally {
      setBusy(null)
    }
  }

  async function push() {
    if (!reader || !detected) return
    setBusy('push')
    try {
      const [{ loadLanContent }, { commitSent }] = await Promise.all([import('@/lib/eink/lan/publisher'), import('@/lib/eink/briefing')])
      const content = await loadLanContent(new Date())
      const epub = await content.makeEpub()
      await pushNow(deviceHttp(), reader, { date: content.date, epub, sleep: content.sleep, briefing: content.briefing }, briefing => commitSent(briefing))
      toast.success(t('push.done'))
    } catch (error) {
      toast.error(t('push.failed', { error: message(error) }))
    } finally {
      setBusy(null)
    }
  }

  async function pickFont(file: File | undefined) {
    if (!file) return
    if (!isValidFontFileName(file.name)) {
      toast.error(t('font.invalid'))
      return
    }
    setFont({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
  }

  return (
    <SettingSection title={t('title')} desc={t('desc')}>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground" data-testid="eink-reader-steps">
        {STEPS.map(step => <li key={step}>{t(`steps.${step}`)}</li>)}
      </ol>
      <ItemGroup className="gap-3">
        <Item variant="outline">
          <ItemMedia variant="icon"><Search /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('detect.title')}</ItemTitle>
            <ItemDescription data-testid="eink-reader-detect-status">
              {!reader
                ? t('detect.needsAddress')
                : detected
                  ? t('detect.found', { version: detected.version, device: detected.device ?? '' })
                  : detectError
                    ? t('detect.notFound')
                    : t('detect.desc')}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button type="button" variant="outline" disabled={!reader || busy !== null} onClick={() => void detect()}>
              <Search />{t('detect.action')}
            </Button>
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemMedia variant="icon"><Download /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('install.title')}</ItemTitle>
            <ItemDescription>{server ? t('install.desc') : t('install.needsServer')}</ItemDescription>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={includeBriefing} onCheckedChange={checked => setIncludeBriefing(checked === true)} />
              {t('install.includeBriefing')}
            </label>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Type className="size-4" />
              <span className="text-muted-foreground">{font ? t('font.selected', { name: font.name }) : t('font.none')}</span>
              <input ref={fontInput} type="file" accept=".ttf,.otf" className="hidden" onChange={event => void pickFont(event.target.files?.[0])} />
              <Button type="button" variant="ghost" size="sm" onClick={() => fontInput.current?.click()}>{t('font.choose')}</Button>
              {font ? <Button type="button" variant="ghost" size="sm" onClick={() => setFont(null)}>{t('font.clear')}</Button> : null}
            </div>
          </ItemContent>
          <ItemActions>
            <Button type="button" disabled={!detected || !server || busy !== null} onClick={() => void install()}>
              <Download />{t('install.action')}
            </Button>
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemMedia variant="icon"><Send /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('push.title')}</ItemTitle>
            <ItemDescription>{t('push.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button type="button" variant="outline" disabled={!detected || busy !== null} onClick={() => void push()}>
              <Send />{t('push.action')}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
    </SettingSection>
  )
}
