'use client'

// Fork（almanac ALMNC-54.13）：Agent 設定區的「調研與回顧」——頻率（預設每週）、彙整日、上次執行時間、現在執行一次。
// 規格第四節「調研與回顧的頻率」：在 Agent 設定區設定，預設每週彙整一次；衝突或錯誤立刻提案，不受頻率影響。
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_REVIEW_SETTINGS, REVIEW_FREQUENCIES, defaultReviewSettingsStore, sanitizeReviewSettings,
  type ReviewFrequency, type ReviewSettings as Settings, type ReviewSettingsStore,
} from '@/lib/review/settings'
import { SettingSection } from '../components/setting-base'

const field = 'w-full rounded-md border border-line bg-bg px-3 py-2 text-ink'

export interface ReviewSettingsProps {
  /** 測試用：換掉存檔與執行。 */
  store?: () => Promise<ReviewSettingsStore>
  runNow?: () => Promise<void>
}

async function defaultRunNow() {
  const { runReviewNow } = await import('@/lib/review/runtime')
  await runReviewNow()
}

export function ReviewSettings({ store = defaultReviewSettingsStore, runNow = defaultRunNow }: ReviewSettingsProps) {
  const t = useTranslations('review.settings')
  const [settings, setSettings] = useState<Settings>(DEFAULT_REVIEW_SETTINGS)
  const [lastRunAt, setLastRunAt] = useState<number | undefined>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'saved' | 'running' | 'loadError' | 'saveError'>('loading')

  useEffect(() => {
    let active = true
    store().then(s => s.load()).then(result => {
      if (!active) return
      setSettings(result.settings)
      setLastRunAt(result.lastRunAt)
      setStatus('ready')
    }).catch(error => {
      console.error('[review] settings load failed', error)
      if (active) setStatus('loadError')
    })
    return () => { active = false }
  }, [store])

  async function save(next: Settings) {
    const clean = sanitizeReviewSettings(next)
    setSettings(clean)
    try {
      await (await store()).save(clean)
      setStatus('saved')
    } catch (error) {
      console.error('[review] settings save failed', error)
      setStatus('saveError')
    }
  }

  async function run() {
    setStatus('running')
    try {
      await runNow()
      const result = await (await store()).load()
      setLastRunAt(result.lastRunAt)
      setStatus('ready')
    } catch (error) {
      console.error('[review] run failed', error)
      setStatus('saveError')
    }
  }

  const weekly = settings.frequency === 'weekly' || settings.frequency === 'biweekly'
  return (
    <SettingSection title={t('title')} desc={t('description')}>
      <div className="space-y-3 text-sm text-ink">
        {(status === 'loadError' || status === 'saveError') && <p role="alert">{t(status)}</p>}
        <label className="block space-y-1">
          <span>{t('frequency')}</span>
          <select
            className={field}
            aria-label={t('frequency')}
            disabled={status === 'loading'}
            value={settings.frequency}
            onChange={event => void save({ ...settings, frequency: event.target.value as ReviewFrequency })}
          >
            {REVIEW_FREQUENCIES.map(frequency => <option key={frequency} value={frequency}>{t(`frequencies.${frequency}`)}</option>)}
          </select>
        </label>
        {weekly && (
          <label className="block space-y-1">
            <span>{t('weekday')}</span>
            <select
              className={field}
              aria-label={t('weekday')}
              value={settings.weekday}
              onChange={event => void save({ ...settings, weekday: Number(event.target.value) })}
            >
              {[0, 1, 2, 3, 4, 5, 6].map(day => <option key={day} value={day}>{t(`weekdays.${day}`)}</option>)}
            </select>
          </label>
        )}
        <p className="text-xs text-muted-foreground" role="status">
          {lastRunAt ? t('lastRun', { time: new Date(lastRunAt).toLocaleString() }) : t('never')}
          {status === 'saved' ? ` · ${t('saved')}` : ''}
        </p>
        <Button type="button" variant="outline" disabled={status === 'running' || status === 'loading' || settings.frequency === 'off'} onClick={() => void run()}>
          {t(status === 'running' ? 'running' : 'runNow')}
        </Button>
      </div>
    </SettingSection>
  )
}
