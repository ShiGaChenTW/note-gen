'use client'

// Fork（almanac ALMNC-45）：設定 > 電子紙。只在新介面（V3）出現；classic 不列在選單、也不顯示內容。
// 設定值與清單邏輯在 src/lib/eink/*（純函式、有單元測試），保存在 store.json（src/stores/eink.ts）。
import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, CloudSun, Eye, EyeOff, FileText, KeyRound, MonitorSmartphone, Power, RefreshCw, Router, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { SettingSection, SettingType } from '../components/setting-base'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { useUiV3 } from '@/lib/fork-ui'
import {
  BRIEFING_SECTIONS, maskEinkToken, normalizeReaderAddress, normalizeWeatherCity, toggleSection,
} from '@/lib/eink/settings'
import useEinkStore from '@/stores/eink'

export default function EinkSettingPage() {
  const v3 = useUiV3()
  return v3 ? <EinkSettings /> : null
}

function EinkSettings() {
  const t = useTranslations('settings.eink')
  const loaded = useEinkStore(state => state.loaded)
  const init = useEinkStore(state => state.init)
  useEffect(() => { void init() }, [init])

  return (
    <SettingType id="eink" title={t('title')} desc={t('desc')} icon={<MonitorSmartphone className="size-4 lg:size-6" />}>
      {loaded ? (
        <>
          <DeviceSection />
          <BriefingSection />
          <PinsSection />
        </>
      ) : null}
    </SettingType>
  )
}

function DeviceSection() {
  const t = useTranslations('settings.eink')
  const settings = useEinkStore(state => state.settings)
  const updateSettings = useEinkStore(state => state.updateSettings)
  const [address, setAddress] = useState(settings.readerAddress)
  useEffect(() => setAddress(settings.readerAddress), [settings.readerAddress])
  const normalizedAddress = normalizeReaderAddress(address)

  async function commitAddress() {
    if (normalizedAddress === null || normalizedAddress === settings.readerAddress) return
    await updateSettings({ readerAddress: normalizedAddress })
  }

  return (
    <SettingSection title={t('sections.device')}>
      <ItemGroup className="gap-3">
        <Item variant="outline">
          <ItemMedia variant="icon"><Power /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('enabled.title')}</ItemTitle>
            <ItemDescription>{t('enabled.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch aria-label={t('enabled.title')} checked={settings.enabled} onCheckedChange={enabled => void updateSettings({ enabled })} />
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemMedia variant="icon"><MonitorSmartphone /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('readerAddress.title')}</ItemTitle>
            <ItemDescription>{normalizedAddress === null ? t('readerAddress.invalid') : t('readerAddress.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Input
              className="w-56"
              value={address}
              placeholder={t('readerAddress.placeholder')}
              aria-label={t('readerAddress.title')}
              aria-invalid={normalizedAddress === null || undefined}
              onChange={event => setAddress(event.target.value)}
              onBlur={() => void commitAddress()}
              onKeyDown={event => { if (event.key === 'Enter') void commitAddress() }}
            />
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemMedia variant="icon"><Router /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('lanServer.title')}</ItemTitle>
            <ItemDescription>{t('lanServer.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch aria-label={t('lanServer.title')} checked={settings.lanServer} onCheckedChange={lanServer => void updateSettings({ lanServer })} />
          </ItemActions>
        </Item>
        <TokenItem />
      </ItemGroup>
    </SettingSection>
  )
}

function TokenItem() {
  const t = useTranslations('settings.eink')
  const token = useEinkStore(state => state.token)
  const regenerateToken = useEinkStore(state => state.regenerateToken)
  const [revealed, setRevealed] = useState(false)

  async function regenerate() {
    await regenerateToken()
    toast.success(t('token.regenerated'))
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><KeyRound /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('token.title')}</ItemTitle>
        <ItemDescription>{t('token.desc')}</ItemDescription>
        <code data-testid="eink-token" className="mt-1 break-all font-mono text-xs text-muted-foreground">
          {revealed ? token : maskEinkToken(token)}
        </code>
      </ItemContent>
      <ItemActions>
        <Button type="button" variant="ghost" size="icon" aria-label={t(revealed ? 'token.hide' : 'token.show')} title={t(revealed ? 'token.hide' : 'token.show')} onClick={() => setRevealed(value => !value)}>
          {revealed ? <EyeOff /> : <Eye />}
        </Button>
        <Button type="button" variant="outline" onClick={() => void regenerate()}>
          <RefreshCw />{t('token.regenerate')}
        </Button>
      </ItemActions>
    </Item>
  )
}

function BriefingSection() {
  const t = useTranslations('settings.eink')
  const settings = useEinkStore(state => state.settings)
  const updateSettings = useEinkStore(state => state.updateSettings)
  const [city, setCity] = useState(settings.weatherCity)
  useEffect(() => setCity(settings.weatherCity), [settings.weatherCity])

  async function commitCity() {
    const next = normalizeWeatherCity(city)
    if (next === settings.weatherCity) return
    await updateSettings({ weatherCity: next })
  }

  return (
    <SettingSection title={t('sections.briefing')} desc={t('briefingSections.desc')}>
      <ItemGroup className="gap-3">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t('briefingSections.title')}</ItemTitle>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BRIEFING_SECTIONS.map(section => (
                <label key={section} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={settings.sections.includes(section)}
                    onCheckedChange={checked => void updateSettings({ sections: toggleSection(settings.sections, section, checked === true) })}
                  />
                  {t(`briefingSections.${section}`)}
                </label>
              ))}
            </div>
          </ItemContent>
        </Item>
        <Item variant="outline">
          <ItemMedia variant="icon"><CloudSun /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('weatherCity.title')}</ItemTitle>
            <ItemDescription>{t('weatherCity.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Input
              className="w-56"
              value={city}
              placeholder={t('weatherCity.placeholder')}
              aria-label={t('weatherCity.title')}
              onChange={event => setCity(event.target.value)}
              onBlur={() => void commitCity()}
              onKeyDown={event => { if (event.key === 'Enter') void commitCity() }}
            />
          </ItemActions>
        </Item>
      </ItemGroup>
    </SettingSection>
  )
}

function fileParts(path: string): { name: string, folder: string } {
  const parts = path.split('/')
  return { name: parts.pop() ?? path, folder: parts.join('/') }
}

function PinsSection() {
  const t = useTranslations('settings.eink.pins')
  const locale = useLocale()
  const pins = useEinkStore(state => state.pins)
  const movePin = useEinkStore(state => state.movePin)
  const removePin = useEinkStore(state => state.removePin)
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale)

  return (
    <SettingSection title={t('title')} desc={t('desc')}>
      {pins.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ItemGroup className="gap-2" data-testid="eink-pins">
          {pins.map((pin, index) => {
            const { name, folder } = fileParts(pin.path)
            return (
              <Item key={pin.path} variant="outline" size="sm">
                <ItemMedia variant="icon"><FileText /></ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">{name}</ItemTitle>
                  <ItemDescription>
                    {folder ? `${folder} · ` : ''}
                    {t('pinnedAt', { date: date(pin.pinnedAt) })}
                    {' · '}
                    {pin.lastSentAt ? t('lastSentAt', { date: date(pin.lastSentAt) }) : t('neverSent')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('moveUp')} title={t('moveUp')} disabled={index === 0} onClick={() => void movePin(pin.path, -1)}><ArrowUp /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('moveDown')} title={t('moveDown')} disabled={index === pins.length - 1} onClick={() => void movePin(pin.path, 1)}><ArrowDown /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('remove')} title={t('remove')} onClick={() => void removePin(pin.path)}><Trash2 /></Button>
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </SettingSection>
  )
}
