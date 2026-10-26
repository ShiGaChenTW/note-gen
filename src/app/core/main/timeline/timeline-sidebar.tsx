'use client'

// Fork（#47）：左側欄下半部的時間軸。先載最近 30 天，捲到底再往前 30 天。
// 點筆記在編輯器打開；點記錄打開 Inbox 頁並展開它。
import { useMemo, useState, type UIEvent } from 'react'
import { CheckCheck, FileText, History } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import type { Mark } from '@/db/marks'
import { openRecordInInbox } from '@/lib/inbox/actions'
import { REPORT_FOLDER } from '@/lib/knowledge-report/topics'
import { buildTimeline, hasOlderThan, type TimelineItem } from '@/lib/timeline/timeline'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import useInboxStore from '@/stores/inbox'
import useVaultIndexStore from '@/stores/vault-index'
import { getMarkListItemContent } from '../mark/mark-list-item-content'
import { MARK_TYPE_ICONS, getMarkTypeIconClasses } from '../mark/mark-type-meta'
import { SIDEBAR_ROW } from '../sidebar-row'

const WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function Row({ item, locale, processedLabel }: { item: TimelineItem, locale: string, processedLabel: string }) {
  const Icon = item.kind === 'note' ? FileText : MARK_TYPE_ICONS[item.type as Mark['type']] ?? FileText
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(item.time)
  const open = () => {
    if (item.kind === 'note') void useArticleStore.getState().setActiveFilePath(item.path)
    else void openRecordInInbox(item.id)
  }
  const processed = item.kind === 'record' && item.processed
  return (
    <button
      type="button"
      onClick={open}
      title={item.kind === 'note' ? item.path : item.title}
      className={cn('flex h-7 w-full items-center gap-2 px-2 text-left text-sm', SIDEBAR_ROW)}
    >
      <Icon className={cn('size-3.5 shrink-0 text-muted-foreground', item.kind === 'record' && getMarkTypeIconClasses(item.type as Mark['type']), processed && 'opacity-60')} aria-hidden />
      <span className={cn('min-w-0 flex-1 truncate', processed && 'text-muted-foreground')}>{item.title}</span>
      {/* 已整理不只靠變淡：另外放一個勾 */}
      {processed && <CheckCheck className="size-3 shrink-0 text-muted-foreground" aria-label={processedLabel} />}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time}</span>
    </button>
  )
}

export function TimelineSidebar() {
  const t = useTranslations('timeline')
  const locale = useLocale()
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const records = useInboxStore(state => state.records)
  const processed = useInboxStore(state => state.processed)
  const dailyFolder = useDailySettingsStore(state => state.dailyFolder)
  const dailyPattern = useDailySettingsStore(state => state.dailyPattern)
  const [windows, setWindows] = useState(1)

  const since = startOfDay(new Date()) - (WINDOW_DAYS * windows - 1) * DAY_MS
  const timelineRecords = useMemo(() => records.map(record => ({
    id: record.id,
    createdAt: record.createdAt,
    type: record.type,
    title: (getMarkListItemContent(record).title || record.url || '').split('\n')[0],
  })), [records])

  const days = useMemo(() => buildTimeline({
    notes: notes.values(),
    records: timelineRecords,
    processedIds: new Set(processed.keys()),
    dailyFolder,
    dailyPattern,
    excludeFolders: [REPORT_FOLDER],
    since,
  }), [notes, revision, timelineRecords, processed, dailyFolder, dailyPattern, since]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasMore = useMemo(
    () => hasOlderThan({ notes: notes.values(), records: timelineRecords }, since),
    [notes, revision, timelineRecords, since], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 80) setWindows(count => count + 1)
  }

  const dayLabel = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' })
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const today = startOfDay(new Date())
  /** 今天、昨天前面加相對日期，其餘只顯示日期。 */
  const heading = (day: string) => {
    const date = new Date(`${day}T00:00:00`)
    const diff = Math.round((date.getTime() - today) / DAY_MS)
    return diff === 0 || diff === -1 ? `${relative.format(diff, 'day')} · ${dayLabel.format(date)}` : dayLabel.format(date)
  }

  return (
    <div className="h-full overflow-y-auto px-2 pb-4" onScroll={onScroll}>
      {days.map(day => (
        <section key={day.day} aria-label={heading(day.day)}>
          <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-sidebar px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            <span className="shrink-0">{heading(day.day)}</span>
            <span className="tabular-nums opacity-70">{day.items.length}</span>
          </h3>
          <div className="flex flex-col gap-px">
            {day.items.map(item => <Row key={item.key} item={item} locale={locale} processedLabel={t('processed')} />)}
          </div>
        </section>
      ))}
      {days.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 pt-10 pb-4 text-center text-sm text-muted-foreground">
          <History className="size-5 opacity-60" aria-hidden />
          <p>{t('empty', { days: WINDOW_DAYS * windows })}</p>
        </div>
      )}
      {hasMore && (
        <button type="button" className={cn('mt-2 flex h-8 w-full items-center justify-center text-xs text-muted-foreground', SIDEBAR_ROW)} onClick={() => setWindows(count => count + 1)}>
          {t('loadMore')}
        </button>
      )}
    </div>
  )
}
