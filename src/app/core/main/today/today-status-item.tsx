'use client'

// Fork (D2): status bar entry "需處理 N" that opens the Today tab.
import useInboxStore, { selectStaleRecords } from '@/stores/inbox'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { groupTasks, needAttentionCount, staleInboxNotes } from '@/lib/today/today-model'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'
import { useUiV3 } from '@/lib/fork-ui'
import { StatusBarItem } from '../status-bar-order'
import { openTodayTab } from './today-tab'

/**
 * Fork（almanac ALMNC-56.7，RPT-2026-009 P05）：要不要算「需處理」（含掃整個 vault 的 Inbox 積壓）。
 * V3 只在索引好了、有提醒時才顯示這一項，索引還沒好時一定不顯示，就不掃；classic 照舊一直算。
 */
export function needsAttentionScan(state: { isV3: boolean, status: string }): boolean {
  return !state.isV3 || state.status === 'ready'
}

export function TodayStatusItem() {
  const t = useTranslations('today')
  const isV3 = useUiV3()
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const status = useVaultIndexStore(state => state.status)
  const inboxFolder = useDailySettingsStore(state => state.inboxFolder)
  const staleDays = useDailySettingsStore(state => state.staleDays)
  const records = useInboxStore(state => state.records)
  const processed = useInboxStore(state => state.processed)
  const initSettings = useDailySettingsStore(state => state.initSettings)
  useEffect(() => { void initSettings() }, [initSettings])

  // 日期換日時重算
  const [day, setDay] = useState(() => new Date().toDateString())
  useEffect(() => {
    const timer = window.setInterval(() => setDay(new Date().toDateString()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const scan = needsAttentionScan({ isV3, status })
  const count = useMemo(() => {
    if (!scan) return 0
    const now = new Date()
    const groups = groupTasks(selectAllTasks({ notes, revision }), now)
    const staleRecords = selectStaleRecords({ records, processed }, staleDays, now).length
    return needAttentionCount(groups, staleInboxNotes(notes.values(), inboxFolder, staleDays, now).length + staleRecords)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, notes, revision, inboxFolder, staleDays, day, records, processed])

  const hasReminder = status === 'ready' && count > 0
  if (isV3 && !hasReminder) return null

  const label = hasReminder ? t('status.need', { count }) : t('status.open')
  return (
    <StatusBarItem id="fork:today" rank={87}>
      <button
        type="button"
        onClick={openTodayTab}
        className={`flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 hover:bg-muted ${count > 0 ? 'text-foreground' : ''}`}
        aria-label={status === 'ready' ? t('status.aria', { count }) : t('status.open')}
        title={t('status.open')}
      >
        {hasReminder
          ? <AlertTriangle className="size-3 text-ink" aria-hidden />
          : <CalendarCheck className="size-3" aria-hidden />}
        <span className="tabular-nums">{label}</span>
      </button>
    </StatusBarItem>
  )
}
