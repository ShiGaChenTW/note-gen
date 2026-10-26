'use client'

// Fork（#47）：左側欄下半部的時間軸。先載最近 30 天，捲到底再往前 30 天。
// 點筆記在編輯器打開；點記錄打開 Inbox 頁並展開它。
import { useMemo, useState, type UIEvent } from 'react'
import { FileText } from 'lucide-react'
import { useLocale } from 'next-intl'

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

const WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function Row({ item, locale }: { item: TimelineItem, locale: string }) {
  const Icon = item.kind === 'note' ? FileText : MARK_TYPE_ICONS[item.type as Mark['type']] ?? FileText
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(item.time)
  const open = () => {
    if (item.kind === 'note') void useArticleStore.getState().setActiveFilePath(item.path)
    else void openRecordInInbox(item.id)
  }
  return (
    <button
      type="button"
      onClick={open}
      title={item.kind === 'note' ? item.path : item.title}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
        item.kind === 'record' && item.processed && 'opacity-50',
      )}
    >
      <Icon className={cn('size-3.5 shrink-0 text-muted-foreground', item.kind === 'record' && getMarkTypeIconClasses(item.type as Mark['type']))} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time}</span>
    </button>
  )
}

export function TimelineSidebar() {
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

  return (
    <div className="h-full overflow-y-auto px-1 pb-4" onScroll={onScroll}>
      {days.map(day => (
        <section key={day.day}>
          <h3 className="sticky top-0 z-10 bg-sidebar px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            {dayLabel.format(new Date(`${day.day}T00:00:00`))}
          </h3>
          {day.items.map(item => <Row key={item.key} item={item} locale={locale} />)}
        </section>
      ))}
      {days.length === 0 && !hasMore && <p className="px-3 py-6 text-center text-sm text-muted-foreground">—</p>}
      {hasMore && (
        <button type="button" className="w-full cursor-pointer py-3 text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => setWindows(count => count + 1)}>
          …
        </button>
      )}
    </div>
  )
}
