'use client'

// Fork（#32）：「可以交給 Agent」。規則在 src/lib/home/signals.ts；設定顯示在「編輯首頁」。
import useInboxStore, { selectUnprocessedRecords } from '@/stores/inbox'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { dailyNotePath } from '@/lib/daily/format'
import { evaluateSignals, isoWeekKey, type SignalRules } from '@/lib/home/signals'
import { groupTasks } from '@/lib/today/today-model'
import useDailySettingsStore from '@/stores/daily-settings'
import useHomeStore from '@/stores/home'
import useVaultIndexStore, { selectAllTasks, selectLinklessPaths } from '@/stores/vault-index'
import { REPORT_FOLDER } from '@/lib/knowledge-report/topics'
import type { NeedItem } from '../home-cards'

/** 每分鐘前進的「現在」，讓「晚上 6 點後」這類規則會自己出現。 */
function useMinuteNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function useSignalNeeds(): NeedItem[] {
  const t = useTranslations('home')
  const now = useMinuteNow()
  const rules = useHomeStore(state => state.signalRules)
  const setHandoff = useHomeStore(state => state.setHandoff)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const status = useVaultIndexStore(state => state.status)
  const { dailyFolder, dailyPattern, inboxFolder } = useDailySettingsStore()
  const records = useInboxStore(state => state.records)
  const processed = useInboxStore(state => state.processed)

  const signals = useMemo(() => {
    if (status !== 'ready') return []
    const prefix = `${inboxFolder.replace(/^\/+|\/+$/g, '')}/`
    const week = isoWeekKey(now)
    // Fork（#46）：Inbox 積壓連還沒整理的記錄一起算
    const inbox = [
      ...[...notes.values()].filter(note => note.path.startsWith(prefix)).map(note => ({ path: note.path, mtime: note.mtime })),
      ...selectUnprocessedRecords({ records, processed }).map(record => ({ path: `record:${record.id}`, mtime: record.createdAt })),
    ]
    return evaluateSignals({
      now,
      overdueDues: groupTasks(selectAllTasks({ notes, revision }), now).overdue.map(task => task.due),
      hasDailyNote: daysAgo => notes.has(dailyNotePath(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo), dailyFolder, dailyPattern)),
      inbox,
      inboxFolder,
      linklessCount: selectLinklessPaths({ notes, revision }, [dailyFolder, inboxFolder], [REPORT_FOLDER]).length,
      // 知識報告的週報（報告/2026-W44 知識報告.md）不是複盤
      weeklyReviewDone: [...notes.keys()].some(path => path.includes(week) && !path.startsWith(`${REPORT_FOLDER}/`)),
    }, rules)
  }, [now, rules, notes, revision, status, dailyFolder, dailyPattern, inboxFolder, records, processed])

  return signals.map(signal => {
    const text = t(`signals.${signal.id}.text`, signal.values)
    return {
      key: `signal:${signal.id}`,
      label: t('needs.signal'),
      tone: 'muted' as const,
      text,
      action: t('needs.handoff'),
      onAction: () => setHandoff({ title: text, prompt: t(`signals.${signal.id}.prompt`, signal.values), kind: 'signal' }),
    }
  })
}

function NumberField({ value, onChange, min, max, label }: { value: number; onChange: (value: number) => void; min: number; max: number; label: string }) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      aria-label={label}
      onChange={event => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))))
      }}
      className="h-7 w-16 px-2 text-xs"
    />
  )
}

/** 「編輯首頁」裡的規則設定：每條可開關，門檻可調。 */
export function SignalRulesSettings() {
  const t = useTranslations('home.rules')
  const rules = useHomeStore(state => state.signalRules)
  const setRules = useHomeStore(state => state.setSignalRules)
  const update = <K extends keyof SignalRules>(key: K, patch: Partial<SignalRules[K]>) => {
    void setRules({ ...rules, [key]: { ...rules[key], ...patch } })
  }
  const row = (key: keyof SignalRules, fields: React.ReactNode) => (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <Switch checked={rules[key].enabled} onCheckedChange={checked => update(key, { enabled: checked })} aria-label={t(`${key}.name`)} />
      <span className="min-w-0 flex-1">{t(`${key}.name`)}</span>
      {fields}
    </div>
  )
  return (
    <div className="mt-1 rounded-md bg-muted/50 px-3 py-1">
      {row('overdue', <>{t('overdue.long')}<NumberField value={rules.overdue.longDays} min={1} max={60} label={t('overdue.long')} onChange={longDays => update('overdue', { longDays })} />{t('days')}</>)}
      {row('dailyNote', <>
        <NumberField value={rules.dailyNote.afterHour} min={0} max={23} label={t('dailyNote.after')} onChange={afterHour => update('dailyNote', { afterHour })} />{t('dailyNote.after')}
        <NumberField value={rules.dailyNote.missingDays} min={0} max={30} label={t('dailyNote.missing')} onChange={missingDays => update('dailyNote', { missingDays })} />{t('dailyNote.missing')}
      </>)}
      {row('inbox', <>
        <NumberField value={rules.inbox.count} min={1} max={500} label={t('inbox.count')} onChange={count => update('inbox', { count })} />{t('inbox.count')}
        <NumberField value={rules.inbox.hours} min={1} max={1440} label={t('inbox.hours')} onChange={hours => update('inbox', { hours })} />{t('inbox.hours')}
      </>)}
      {row('linkless', <><NumberField value={rules.linkless.count} min={1} max={10000} label={t('linkless.count')} onChange={count => update('linkless', { count })} />{t('linkless.count')}</>)}
      {row('weeklyReview', <><NumberField value={rules.weeklyReview.afterHour} min={0} max={23} label={t('weeklyReview.after')} onChange={afterHour => update('weeklyReview', { afterHour })} />{t('weeklyReview.after')}</>)}
    </div>
  )
}
