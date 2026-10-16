'use client'

// Fork (D1): 日記 settings section.
import { useEffect, useState } from 'react'
import { CalendarDays, CalendarPlus, FolderOpen, Inbox, LayoutTemplate } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { SettingSection, SettingType } from '../components/setting-base'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { dailyNotePath, isValidDailyPattern } from '@/lib/daily/format'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/daily/template'
import { openDailyNote } from '@/lib/daily/open-daily-note'
import useDailySettingsStore, { type DailySettings } from '@/stores/daily-settings'

// Monday first, like the vault's week view.
const WEEKDAY_ORDER: WeekdayKey[] = [...WEEKDAY_KEYS.slice(1), WEEKDAY_KEYS[0]]

type TextKey = 'dailyFolder' | 'dailyPattern' | 'inboxFolder' | 'defaultTemplate'

function TextSetting({
  settingKey,
  icon,
  validate,
}: {
  settingKey: TextKey
  icon: React.ReactNode
  validate?: (value: string) => boolean
}) {
  const t = useTranslations('settings.daily')
  const value = useDailySettingsStore(state => state[settingKey])
  const updateSetting = useDailySettingsStore(state => state.updateSetting)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const invalid = validate ? !validate(draft) : false

  async function commit() {
    const next = draft.trim()
    if (next === value) return
    if (validate && !validate(next)) return
    await updateSetting(settingKey, next as DailySettings[TextKey])
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{t(`${settingKey}.title`)}</ItemTitle>
        <ItemDescription>{invalid ? t(`${settingKey}.invalid`) : t(`${settingKey}.desc`)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Input
          className="w-56"
          value={draft}
          aria-invalid={invalid || undefined}
          aria-label={t(`${settingKey}.title`)}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={event => { if (event.key === 'Enter') void commit() }}
        />
      </ItemActions>
    </Item>
  )
}

function WeekdayTemplate({ weekday }: { weekday: WeekdayKey }) {
  const t = useTranslations('settings.daily')
  const weekdayTemplates = useDailySettingsStore(state => state.weekdayTemplates)
  const updateSetting = useDailySettingsStore(state => state.updateSetting)
  const value = weekdayTemplates[weekday] ?? ''
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  async function commit() {
    const next = draft.trim()
    if (next === value) return
    await updateSetting('weekdayTemplates', { ...weekdayTemplates, [weekday]: next })
  }

  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-sm text-muted-foreground">{t(`weekdays.${weekday}`)}</span>
      <Input
        value={draft}
        placeholder={t('weekdayTemplates.placeholder')}
        aria-label={t(`weekdays.${weekday}`)}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={event => { if (event.key === 'Enter') void commit() }}
      />
    </div>
  )
}

export default function DailySettingPage() {
  const t = useTranslations('settings.daily')
  const { initialized, initSettings, openOnLaunch, dailyFolder, dailyPattern, updateSetting } = useDailySettingsStore()
  const [opening, setOpening] = useState(false)

  useEffect(() => { void initSettings() }, [initSettings])

  async function handleOpenToday() {
    setOpening(true)
    try {
      const result = await openDailyNote()
      toast.success(result.created ? t('open.created') : t('open.opened'))
    } catch (error) {
      console.error('Failed to open daily note:', error)
      toast.error(t('open.error'))
    } finally {
      setOpening(false)
    }
  }

  if (!initialized) return null

  return (
    <SettingType id="daily" icon={<CalendarDays />} title={t('title')} desc={t('desc')}>
      <SettingSection
        title={t('sections.today')}
        desc={t('open.preview', { path: dailyNotePath(new Date(), dailyFolder, dailyPattern) })}
        actions={(
          <Button size="sm" disabled={opening} onClick={() => void handleOpenToday()}>
            <CalendarPlus />
            {t('open.button')}
          </Button>
        )}
      >
        <Item variant="outline">
          <ItemMedia variant="icon"><CalendarDays /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('openOnLaunch.title')}</ItemTitle>
            <ItemDescription>{t('openOnLaunch.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions className="mobile-setting-inline-action">
            <Switch
              checked={openOnLaunch}
              aria-label={t('openOnLaunch.title')}
              onCheckedChange={checked => void updateSetting('openOnLaunch', checked)}
            />
          </ItemActions>
        </Item>
      </SettingSection>

      <SettingSection title={t('sections.location')}>
        <ItemGroup className="gap-3">
          <TextSetting settingKey="dailyFolder" icon={<FolderOpen />} />
          <TextSetting settingKey="dailyPattern" icon={<CalendarDays />} validate={isValidDailyPattern} />
          <TextSetting settingKey="inboxFolder" icon={<Inbox />} />
        </ItemGroup>
      </SettingSection>

      <SettingSection title={t('sections.templates')} desc={t('templatesDesc')}>
        <ItemGroup className="gap-3">
          <TextSetting settingKey="defaultTemplate" icon={<LayoutTemplate />} />
          <Item variant="outline">
            <ItemContent className="gap-3">
              <ItemTitle>{t('weekdayTemplates.title')}</ItemTitle>
              <ItemDescription>{t('weekdayTemplates.desc')}</ItemDescription>
              <div className="flex flex-col gap-2">
                {WEEKDAY_ORDER.map(weekday => <WeekdayTemplate key={weekday} weekday={weekday} />)}
              </div>
            </ItemContent>
          </Item>
        </ItemGroup>
      </SettingSection>
    </SettingType>
  )
}
