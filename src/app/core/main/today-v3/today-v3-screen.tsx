'use client'

// Fork（almanac ALMNC-16.2）：v5「今天」主畫面（新介面 v3）。三欄：
//   左  06–24 時間軸    中  日誌＋今天要完成    右  等你定＋今天收進來
// 底部「記／問」輸入列。掛在首頁覆蓋層（home store）上：v3 時 HomeScreen 顯示這個畫面，classic 時維持原首頁。
// 資料組裝在 lib/today-v3/layout.ts（純函式）；寫回（勾選任務）沿用今日頁的 use-today-actions。
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TodayV3Layout, TodoItem } from '@/lib/today-v3/layout'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import useHomeStore from '@/stores/home'
import { Count } from '@/components/v3/count'
import { EmptyState } from '@/components/v3/empty-state'
import { SectionLabel } from '@/components/v3/section-label'
import { PageHeader, PageSurface } from '../page-ui'
import { useTodayActions } from '../today/use-today-actions'
import { TodayComposer } from './composer'
import { Timeline } from './timeline'
import { usePendingSlots } from '@/lib/timeslots/use-pending-slots'
import { useDecisions } from '@/lib/decide/use-decisions'
import { useDecideActions } from '../decide/decide-parts'
import { buildProposalBlocks } from '@/lib/today-v3/layout'
import { openDailyNote } from '@/lib/daily/open-daily-note'
import { toDateKey } from '@/lib/daily/format'
import { useDateFormats } from '@/lib/date-format'
import { dateFromDayKey } from '@/lib/today-v3/date-strip'
import { DateStrip } from './date-strip'
import { useTodayV3Data } from './use-today-v3-data'
import { WorkbenchLine } from './workbench-line'
import { useWorkbenchCount } from '@/lib/workbench/use-workbench'

function Journal({ layout, dateLabel, viewingToday, exists, onOpen }: { layout: TodayV3Layout, dateLabel: string, viewingToday: boolean, exists: boolean, onOpen: () => void }) {
  const t = useTranslations('todayV3.journal')
  const [focus, setFocus] = useState(false)
  const { heading, paragraphs } = layout.journal
  return (
    <div className="flex max-w-[600px] flex-col gap-3.5" data-testid="today-v3-journal">
      <SectionLabel trailing={
        <Button variant="ghost" size="sm" className="rounded-(--r)" aria-pressed={focus} onClick={() => setFocus(value => !value)}>{focus ? t('focusOff') : t('focus')}</Button>
      }>
        {t('label')} · <span className="tabular-nums">{dateLabel}</span>
      </SectionLabel>
      {heading && <h2 className={cn('text-2xl leading-8 font-semibold tracking-tight transition-opacity duration-150', focus && 'opacity-35')}>{heading}</h2>}
      {paragraphs.length === 0 && (
        <EmptyState
          text={viewingToday ? t('empty') : t(exists ? 'emptyDay' : 'missingDay')}
          action={<button type="button" onClick={onOpen} className="cursor-pointer text-brand outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring/65">{viewingToday || exists ? t('open') : t('create')}</button>}
        />
      )}
      {paragraphs.map((text, index) => {
        const active = index === paragraphs.length - 1
        return (
          <p
            key={`${index}:${text}`}
            className={cn('text-ui-emphasis leading-[1.8] text-note-ink transition-opacity duration-150', active && 'border-l-2 border-line pl-3.5', focus && !active && 'opacity-35')}
          >{text}</p>
        )
      })}
    </div>
  )
}

function TodoRow({ item, busy, onToggle }: { item: TodoItem, busy: boolean, onToggle: (item: TodoItem) => void }) {
  const t = useTranslations('todayV3.todo')
  const dueText = item.due.kind === 'time' ? item.due.time : item.due.kind === 'overdue' ? t('overdue', { days: item.due.days }) : ''
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={t(item.done ? 'uncheck' : 'check', { title: item.title })}
        disabled={busy}
        onClick={() => onToggle(item)}
        className="-mx-1.5 flex min-h-9 w-[calc(100%+12px)] cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-left transition-colors duration-100 outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring/65 disabled:opacity-60"
      >
        <span className={cn('grid size-[15px] shrink-0 place-items-center rounded-[4px] border-[1.5px] transition-colors duration-100', item.done ? 'border-brand bg-brand text-brand-ink' : 'border-faint')}>
          {item.done && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
        </span>
        <span className={cn('min-w-0 flex-1 truncate text-sm', item.done && 'text-muted-ink line-through')}>{item.title}</span>
        <span className={cn('shrink-0 text-right text-muted-ink tabular-nums', item.due.kind === 'time' ? 'font-mono text-ui-numeric' : 'text-ui-compact', item.hot && !item.done && 'font-semibold text-ink')}>{dueText}</span>
      </button>
    </li>
  )
}

function Todo({ layout, busy, viewingToday, shortDate, onToggle }: { layout: TodayV3Layout, busy: ReadonlySet<string>, viewingToday: boolean, shortDate: string, onToggle: (item: TodoItem) => void }) {
  const t = useTranslations('todayV3.todo')
  const { items, doneCount, total } = layout.todo
  return (
    <div className="mt-7 max-w-[600px]" data-testid="today-v3-todo">
      <SectionLabel as="h2" underline trailing={<Count value={doneCount} total={total} />}>
        {viewingToday ? t('label') : t('labelDay', { date: shortDate })}
      </SectionLabel>
      {items.length === 0
        ? <EmptyState className="py-3" text={t(viewingToday ? 'empty' : 'emptyDay')} />
        : <ul>{items.map(item => <TodoRow key={item.key} item={item} busy={busy.has(item.key)} onToggle={onToggle} />)}</ul>}
    </div>
  )
}

function DecideRail({ layout }: { layout: TodayV3Layout }) {
  const t = useTranslations('todayV3.decide')
  const decideT = useTranslations('decide')
  const show = useDecideStore(state => state.show)
  const select = useDecideStore(state => state.select)
  const jobT = useTranslations('jobs')
  const { count, items } = layout.decide
  return (
    <section data-testid="today-v3-decide">
      <SectionLabel as="h2" underline trailing={<Count value={count} emphasis />}>{t('label')}</SectionLabel>
      {items.length === 0 && <EmptyState className="py-3" text={t('empty')} />}
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          onClick={() => { show(); select(item.key) }}
          className="-mx-1.5 block w-[calc(100%+12px)] cursor-pointer rounded-md px-1.5 py-2 text-left transition-colors duration-100 outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring/65"
        >
          <div className="text-ui-compact leading-5 font-medium">{item.title}</div>
          <div className="text-ui-compact text-muted-ink">{[item.origin, item.kind === 'job' ? jobT('result') : decideT(`kind.${item.kind}`)].filter(Boolean).join(' · ')}</div>
        </button>
      ))}
      {count > items.length && (
        <button type="button" onClick={show} className="mt-1 cursor-pointer text-ui-compact font-medium text-brand outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring/65">{t('all')}</button>
      )}
    </section>
  )
}

function CaptureRail({ layout }: { layout: TodayV3Layout }) {
  const t = useTranslations('todayV3.captures')
  const show = useCollectStore(state => state.show)
  const { items, total } = layout.captures
  return (
    <section data-testid="today-v3-captures">
      <SectionLabel underline trailing={
        <div className="flex shrink-0 items-center gap-2">
          <Count value={total} />
          <button type="button" onClick={show} className="cursor-pointer text-ui-compact font-medium text-muted-ink outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring/65">{t('all')}</button>
        </div>
      }>{t('label')}</SectionLabel>
      {items.length === 0 && <EmptyState className="py-3" text={t('empty')} />}
      {items.map(item => (
        <div key={item.key} className="flex items-baseline gap-2.5 py-1.5">
          <SectionLabel as="span" className="w-10 shrink-0">{t(`kind.${item.kind}`)}</SectionLabel>
          {item.loading
            ? <span className="flex flex-1 flex-col gap-2" role="status" aria-label={t('reading')}><i className="block h-2 motion-safe:animate-pulse rounded bg-sunken" /><i className="block h-2 w-3/5 motion-safe:animate-pulse rounded bg-sunken" /></span>
            : <span className="min-w-0 flex-1 truncate text-ui-compact leading-5" title={item.title}>{item.title}</span>}
        </div>
      ))}
    </section>
  )
}

export function TodayV3Screen() {
  const t = useTranslations('todayV3')
  const dates = useDateFormats()
  const hide = useHomeStore(state => state.hide)
  // 選中日：null = 跟著今天（跨午夜也跟）；其餘為 YYYY-MM-DD。資料以選中日為準，記一筆、時段提案、現在線仍以今天為準。
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const pickedDay = useMemo(() => (pickedKey ? dateFromDayKey(pickedKey) : undefined), [pickedKey])
  const { now, day, dayKey, viewingToday, tasks, todayPath, noteKeys, journalExists, layout, calendarAccess } = useTodayV3Data(pickedDay)
  const { busy, toggleTask, openNote } = useTodayActions({ now, tasks })
  const todayKey = toDateKey(now)
  const { due, overdue } = layout.summary
  const monthDay = dates.monthDay(day)
  const shortDate = dates.short(day)
  // ALMNC-16：排程員的時段提案畫在時間軸上，收下／不要與等你定共用同一份狀態
  const pendingSlots = usePendingSlots(toDateKey(now))
  const proposals = useMemo(() => buildProposalBlocks(pendingSlots), [pendingSlots])
  const decisions = useDecisions()
  const decide = useDecideActions()
  const decisionByKey = (key: string) => decisions.find(item => item.key === key)
  // Fork（almanac ALMNC-54.14）：「工作台 · N 件」，和側欄同一個數字。
  const workbenchCount = useWorkbenchCount()
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const openJournal = () => {
    hide()
    if (viewingToday) openNote(todayPath)
    else void openDailyNote(day) // 那天沒有日記時依模板建立，已有就直接打開
  }
  const selectDay = (key: string) => setPickedKey(key === toDateKey(now) ? null : key)
  const openTask = (path: string) => { hide(); openNote(path) }

  return (
    <PageSurface label={t('title')} onDismiss={hide}>
      <PageHeader
        title={viewingToday ? t('title') : t('titleDay', { date: monthDay })}
        subtitle={
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="tabular-nums" data-testid="today-v3-summary">
              {[
                !viewingToday && t('viewing'),
                t('dateLabel', { date: dates.full(day), week: dates.week(day) }),
                due > 0 && t('summaryDue', { count: due }),
                overdue > 0 && t('summaryOverdue', { count: overdue }),
              ].filter(Boolean).join(' · ')}
            </span>
            <WorkbenchLine count={workbenchCount} />
          </span>
        }
        onBack={hide}
      />
      <DateStrip todayKey={todayKey} selectedKey={dayKey} noteKeys={noteKeys} onSelect={selectDay} onToday={() => setPickedKey(null)} />
      <div className="@container min-h-0 flex-1">
      <div className="grid h-full grid-cols-[280px_minmax(0,1fr)_300px] @max-[1000px]:grid-cols-[240px_minmax(0,1fr)]">
        <div className="min-w-0 overflow-y-auto px-6 pt-5 pb-24" data-testid="today-v3-left">
          <Timeline
            view={layout.timeline}
            onOpenTask={openTask}
            noAccess={calendarAccess === 'denied' || calendarAccess === 'restricted'}
            dayKey={dayKey}
            proposals={viewingToday ? proposals : []}
            busyKey={decide.busy}
            onAccept={key => { const item = decisionByKey(key); if (item) void decide.accept(item) }}
            onReject={key => { const item = decisionByKey(key); if (item) void decide.reject(item) }}
          />
        </div>
        <div className="min-w-0 overflow-y-auto border-l border-line-soft px-10 pt-8 pb-28" data-testid="today-v3-center">
          <Journal layout={layout} dateLabel={viewingToday ? clock : shortDate} viewingToday={viewingToday} exists={journalExists} onOpen={openJournal} />
          <Todo layout={layout} busy={busy} shortDate={shortDate} viewingToday={viewingToday} onToggle={item => toggleTask(item.task, !item.done)} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 overflow-y-auto border-l border-line-soft px-6 pt-5 pb-24 @max-[1000px]:hidden" data-testid="today-v3-right">
          <DecideRail layout={layout} />
          <CaptureRail layout={layout} />
        </div>
      </div>
      </div>
      <TodayComposer viewingLabel={viewingToday ? null : shortDate} />
    </PageSurface>
  )
}
