'use client'

// Fork (D2): native Today page, design v2 (personal/notegen-today-d2-redesign.html).
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  CalendarDays,
  ChevronUp,
  Clock,
  FileText,
  Inbox,
  List,
  MoreHorizontal,
  Moon,
  RefreshCw,
  Repeat,
  Sun,
  Target,
  Rows3,
  Zap,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { parseDailyNote, type DailyNote } from '@/lib/daily/daily-note'
import { dailyNotePath } from '@/lib/daily/format'
import { openDailyNote } from '@/lib/daily/open-daily-note'
import { readNote } from '@/lib/daily/note-io'
import { useCalendarEvents } from '@/lib/calendar/calendar'
import type { TaskRef } from '@/lib/vault-index/index-core'
import {
  buildAgenda,
  buildWeek,
  dateKey,
  daysBetween,
  groupTasks,
  staleInboxNotes,
  type AgendaItem,
} from '@/lib/today/today-model'
import {
  carryYesterdayTasks,
  countCarryable,
  quickAddTask,
  scheduleTask,
  setTaskChecked,
  stampToday,
  StaleTaskError,
  undoWrites,
  type WriteRecord,
} from '@/lib/today/today-actions'
import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'
import { DailyCalendarPopover } from '../daily/daily-calendar'
import { QuickAdd } from './quick-add'
import { ScheduleButton, TASK_DRAG_MIME, taskDragKey, TimeBlocks } from './time-blocks'

/** 分鐘級的「現在」，讓進程與「現在」線每分鐘前進。 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const align = window.setTimeout(() => {
      tick()
      timer = window.setInterval(tick, 60_000)
    }, 60_000 - (Date.now() % 60_000))
    let timer: number | undefined
    return () => {
      window.clearTimeout(align)
      if (timer) window.clearInterval(timer)
    }
  }, [])
  return now
}

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function sourceName(path: string): string {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? path
}

export function TodayPage() {
  const t = useTranslations('today')
  const locale = useLocale()
  const now = useNow()
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`

  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const indexStatus = useVaultIndexStore(state => state.status)
  const tasks = useMemo(() => selectAllTasks({ notes, revision }), [notes, revision])

  const settings = useDailySettingsStore()
  const initDailySettings = useDailySettingsStore(state => state.initSettings)
  useEffect(() => { void initDailySettings() }, [initDailySettings])
  const todayPath = dailyNotePath(now, settings.dailyFolder, settings.dailyPattern)
  const todayMtime = notes.get(todayPath)?.mtime ?? 0

  const [dailyNote, setDailyNote] = useState<DailyNote | null>(null)
  useEffect(() => {
    let cancelled = false
    void readNote(todayPath).then(content => {
      if (!cancelled) setDailyNote(content === null ? null : parseDailyNote(content))
    }).catch(() => { if (!cancelled) setDailyNote(null) })
    return () => { cancelled = true }
  }, [todayPath, todayMtime])

  const [carryable, setCarryable] = useState(0)
  useEffect(() => {
    let cancelled = false
    void countCarryable(now).then(count => { if (!cancelled) setCarryable(count) }).catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, revision])

  const calendar = useCalendarEvents(now)
  const groups = useMemo(() => groupTasks(tasks, now), [tasks, now])
  const agenda = useMemo(
    () => buildAgenda({ now, dailyNote, tasks, events: calendar.events }),
    [now, dailyNote, tasks, calendar.events],
  )
  const week = useMemo(() => buildWeek({
    now,
    tasks,
    dailyNotePathFor: day => dailyNotePath(day, settings.dailyFolder, settings.dailyPattern),
    hasNote: path => notes.has(path),
  }), [now, tasks, notes, settings.dailyFolder, settings.dailyPattern])
  const staleInbox = useMemo(
    () => staleInboxNotes(notes.values(), settings.inboxFolder, settings.staleDays, now),
    [notes, settings.inboxFolder, settings.staleDays, now],
  )

  const [busy, setBusy] = useState<string | null>(null)
  const runWrite = useCallback(async <T extends WriteRecord>(key: string, action: () => Promise<T>, success: (record: T) => string): Promise<boolean> => {
    setBusy(key)
    try {
      const record = await action()
      if (record.writes.length === 0) return false
      toast(success(record), {
        action: {
          label: t('undo'),
          onClick: () => {
            void undoWrites(record).then(ok => { if (!ok) toast.error(t('undoStale')) })
          },
        },
      })
      return true
    } catch (error) {
      if (error instanceof StaleTaskError) toast.error(t('taskStale', { name: sourceName(error.path) }))
      else {
        console.error('[today] write failed:', error)
        toast.error(t('writeFailed'))
      }
      return false
    } finally {
      setBusy(null)
    }
  }, [t])

  const toggleTask = useCallback((task: TaskRef, checked: boolean) => {
    void runWrite(`${task.path}:${task.line}`, () => setTaskChecked(task, checked), record => (
      record.nextDue !== undefined
        ? t('taskDoneNext', { name: sourceName(task.path), date: record.nextDue || t('noDate') })
        : checked ? t('taskDone', { name: sourceName(task.path) }) : t('taskUndone', { name: sourceName(task.path) })
    ))
  }, [runWrite, t])

  const schedule = useCallback((task: TaskRef, time: string) => {
    void runWrite(`${task.path}:${task.line}`, () => scheduleTask(task, time), () => (
      time ? t('timeBlocks.scheduled', { time }) : t('timeBlocks.cleared')
    ))
  }, [runWrite, t])

  const dropTask = useCallback((dragKey: string, time: string) => {
    const task = tasks.find(candidate => taskDragKey(candidate) === dragKey)
    if (task) schedule(task, time)
  }, [tasks, schedule])

  const addTask = useCallback((input: string) => runWrite('quick-add', () => quickAddTask(input, new Date()), record => (
    t('quickAdd.added', { name: record.task.title })
  )), [runWrite, t])

  const openNote = useCallback((path: string) => {
    void useArticleStore.getState().setActiveFilePath(path)
  }, [])

  const dateTitle = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(now)
  const hour = now.getHours()
  const greeting = hour < 12 ? t('greeting.morning') : hour < 18 ? t('greeting.afternoon') : t('greeting.evening')
  const todayGroup = groups.upcoming[0]
  const mits = dailyNote?.mits ?? []
  const mitDone = mits.filter(mit => mit.done).length

  return (
    <div className="@container h-full w-full overflow-y-auto bg-card">
      <main className="mx-auto flex max-w-6xl flex-col gap-3.5 p-5" aria-label={t('title')}>
        {/* 1. 頂列：日期、本週、單一主要動作 */}
        <div className="flex flex-wrap items-center gap-5">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight">{dateTitle}</h1>
            <p className="text-sm text-muted-foreground">
              {greeting} · <span className="tabular-nums">{hhmm(now.getTime())}</span>
              {' · '}{t('summary', { today: todayGroup?.tasks.length ?? 0, overdue: groups.overdue.length })}
            </p>
          </div>

          <nav className="ml-auto flex gap-1 @max-[56rem]:order-3 @max-[56rem]:ml-0 @max-[56rem]:w-full @max-[56rem]:justify-between" aria-label={t('week.label')}>
            {week.map(day => {
              const date = new Date(`${day.date}T00:00:00`)
              const label = new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(date)
              return (
                <button
                  key={day.date}
                  type="button"
                  aria-current={day.isToday ? 'date' : undefined}
                  aria-label={t('week.day', { date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' }).format(date), open: day.open })}
                  onClick={() => void openDailyNote(date)}
                  className={cn(
                    'flex h-12 w-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-muted-foreground transition-colors hover:bg-muted',
                    day.isToday && 'bg-primary/10 ring-1 ring-primary/50 ring-inset',
                  )}
                >
                  <span className="text-xs">{label}</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{date.getDate()}</span>
                  <span className={cn('size-1.5 rounded-full', day.open > 0 ? 'bg-primary' : day.hasNote ? 'bg-muted-foreground/70' : 'bg-transparent')} />
                </button>
              )
            })}
            <DailyCalendarPopover selected={now}>
              <button
                type="button"
                aria-label={t('calendarNav.open')}
                title={t('calendarNav.open')}
                className="grid h-12 w-11 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <CalendarDays className="size-4" aria-hidden />
              </button>
            </DailyCalendarPopover>
          </nav>

          <div className="flex items-center gap-2">
            <Button className="h-10 gap-2 px-4 font-semibold" onClick={() => void openDailyNote(now)}>
              <FileText className="size-4" aria-hidden />{t('openDaily')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="size-10" aria-label={t('moreActions')}>
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={dailyNote?.morning} onSelect={() => void runWrite('morning', () => stampToday('morning', now), () => t('stamped.morning'))}>
                  <Sun className="size-4" aria-hidden />{dailyNote?.morning ? t('morningDone') : t('morning')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={dailyNote?.reviewed} onSelect={() => void runWrite('review', () => stampToday('review', now), () => t('stamped.review'))}>
                  <Moon className="size-4" aria-hidden />{dailyNote?.reviewed ? t('reviewDone') : t('review')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={indexStatus === 'scanning'} onSelect={() => void useVaultIndexStore.getState().rescan?.()}>
                  <RefreshCw className="size-4" aria-hidden />{indexStatus === 'scanning' ? t('index.scanning') : t('index.rescan')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* 2. 焦點：唯一要務、定調、三件 MIT */}
        <section className="grid grid-cols-[1.3fr_1fr] gap-6 rounded-xl bg-background p-5 @max-[56rem]:grid-cols-1" aria-labelledby="today-one">
          <div className="min-w-0">
            <div id="today-one" className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
              <Target className="size-4" aria-hidden />{t('oneThing')}
            </div>
            <p className="mt-1.5 text-2xl font-bold leading-snug [overflow-wrap:anywhere]">
              {dailyNote?.oneThing?.text || <span className="text-muted-foreground">{t('notFilled')}</span>}
            </p>
            {dailyNote?.tone && <p className="mt-1 text-sm text-muted-foreground">{t('tone', { tone: dailyNote.tone })}</p>}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t('mits', { done: mitDone, total: mits.length })}</div>
            {mits.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t('notFilled')}</p>}
            <ul className="mt-1.5 grid gap-1">
              {mits.map(mit => (
                <li key={mit.lineNo} className="flex min-h-11 items-center gap-2.5 rounded-lg px-2">
                  <span className={cn('h-3.5 w-1 rounded-full', mit.priority >= 3 ? 'bg-primary' : 'bg-muted-foreground/60')} aria-hidden />
                  <span className={cn('min-w-0 [overflow-wrap:anywhere]', mit.done && 'text-muted-foreground line-through')}>
                    {mit.text}
                    {mit.done && <span className="sr-only">{t('done')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 3. 主體：今日進程、任務 */}
        <div className="grid grid-cols-[1fr_1.25fr] items-start gap-3.5 @max-[56rem]:grid-cols-1">
          <AgendaPanel agenda={agenda} calendar={calendar} now={now} onDropTask={dropTask} />

          <section className="rounded-xl bg-background p-4" aria-labelledby="today-tasks">
            <header className="mb-2.5 flex items-center gap-2.5">
              <h2 id="today-tasks" className="text-[15px] font-semibold">{t('tasks.title')}</h2>
              <span className="ml-auto text-xs text-muted-foreground">{t('tasks.counts', { pending: groups.pendingCount, done: groups.doneToday.length })}</span>
            </header>

            <QuickAdd now={now} busy={busy === 'quick-add'} onSubmit={addTask} />

            {carryable > 0 && (
              <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-primary/10 px-3 py-2.5">
                <ArrowDownToLine className="size-4 text-primary" aria-hidden />
                <p className="text-sm">{t('carry.prompt', { count: carryable })}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto border-primary/50 text-primary"
                  disabled={busy === 'carry'}
                  onClick={() => void runWrite('carry', () => carryYesterdayTasks(now), record => t('carry.done', { count: (record as WriteRecord & { moved: number }).moved }))}
                >
                  {t('carry.action')}
                </Button>
              </div>
            )}

            {groups.pendingCount === 0 && groups.doneToday.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {indexStatus === 'ready' ? t('tasks.empty') : t('tasks.loading')}
              </p>
            )}

            {groups.overdue.length > 0 && (
              <TaskGroup
                heading={<><AlertTriangle className="size-3.5 text-primary" aria-hidden />{t('tasks.overdue', { count: groups.overdue.length })}</>}
                tasks={groups.overdue}
                renderMeta={task => (
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                    {t('tasks.lateBy', { days: daysBetween(task.due, dateKey(now)) })}
                  </span>
                )}
                busy={busy}
                onToggle={toggleTask}
                onOpen={openNote}
                onSchedule={schedule}
              />
            )}
            {groups.upcoming.map(day => day.tasks.length > 0 && (
              <TaskGroup
                key={day.date}
                heading={t(`tasks.day${day.offset}` as 'tasks.day0', { count: day.tasks.length })}
                tasks={day.tasks}
                renderMeta={task => task.time
                  ? <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums"><Clock className="size-3" aria-hidden />{task.time}</span>
                  : null}
                busy={busy}
                onToggle={toggleTask}
                onOpen={openNote}
                onSchedule={schedule}
              />
            ))}
            {groups.doneToday.length > 0 && (
              <TaskGroup heading={t('tasks.doneToday', { count: groups.doneToday.length })} tasks={groups.doneToday} renderMeta={() => null} busy={busy} onToggle={toggleTask} onOpen={openNote} onSchedule={schedule} />
            )}
          </section>
        </div>

        {/* 4. 今日足跡 */}
        <div className="grid grid-cols-3 gap-3.5 @max-[56rem]:grid-cols-1">
          <Tile icon={<Zap className="size-4" aria-hidden />} value={String(dailyNote?.capture.total ?? 0)} label={t('capture.title')}
            detail={t('capture.detail', { flash: dailyNote?.capture.flash ?? 0, read: dailyNote?.capture.read ?? 0, task: dailyNote?.capture.task ?? 0 })} />
          <Tile icon={<Inbox className="size-4" aria-hidden />} warn={staleInbox.length > 0} value={String(staleInbox.length)} label={t('inbox.title')}
            detail={t('inbox.detail', { days: settings.staleDays })}
            action={staleInbox[0] ? { label: t('inbox.action'), onClick: () => openNote(staleInbox[0].path) } : undefined} />
          <Tile icon={<Moon className="size-4" aria-hidden />} value={dailyNote?.reflection.filled ? t('reflection.filled') : t('reflection.empty')} label={t('reflection.title')}
            detail={dailyNote?.reviewed ? t('reviewDone') : t('reflection.detail')}
            action={{ label: t('reflection.action'), onClick: () => void openDailyNote(now) }} />
        </div>
      </main>
    </div>
  )
}

function TaskGroup({ heading, tasks, renderMeta, busy, onToggle, onOpen, onSchedule }: {
  heading: React.ReactNode
  tasks: TaskRef[]
  renderMeta: (task: TaskRef) => React.ReactNode
  busy: string | null
  onToggle: (task: TaskRef, checked: boolean) => void
  onOpen: (path: string) => void
  onSchedule: (task: TaskRef, time: string) => void
}) {
  const t = useTranslations('today')
  return (
    <>
      <h3 className="flex items-center gap-1.5 px-2 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">{heading}</h3>
      <ul className="grid gap-0.5">
        {tasks.map(task => (
          <li
            key={`${task.path}:${task.line}`}
            draggable={!task.done}
            onDragStart={event => {
              event.dataTransfer.setData(TASK_DRAG_MIME, taskDragKey(task))
              event.dataTransfer.effectAllowed = 'move'
            }}
            className={cn('group grid min-h-11 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-muted', !task.done && 'cursor-grab active:cursor-grabbing')}
          >
            <Checkbox
              className="size-[18px]"
              checked={task.done}
              disabled={busy === `${task.path}:${task.line}`}
              onCheckedChange={checked => onToggle(task, checked === true)}
              aria-label={task.title}
            />
            <div className="min-w-0">
              <span className={cn('block [overflow-wrap:anywhere]', task.done && 'text-muted-foreground line-through')}>{task.title}</span>
              <button type="button" className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => onOpen(task.path)} aria-label={t('openSource', { name: task.path })}>
                {task.recurrence ? <Repeat className="size-3" aria-hidden /> : <FileText className="size-3" aria-hidden />}
                <span className="truncate">{task.recurrence ? `${task.recurrence} · ` : ''}{task.path}</span>
              </button>
            </div>
            <span className="flex items-center gap-1.5">
              {task.priority === 'high' && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary">
                  <ChevronUp className="size-3.5" aria-hidden />{t('priorityHigh')}
                </span>
              )}
              {renderMeta(task)}
              {!task.done && (
                <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <ScheduleButton task={task} disabled={busy === `${task.path}:${task.line}`} onSchedule={onSchedule} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

const AGENDA_VIEW_KEY = 'notegen.today.agendaView'

function useAgendaView(): ['list' | 'blocks', (view: 'list' | 'blocks') => void] {
  const [view, setView] = useState<'list' | 'blocks'>(() => {
    try { return window.localStorage.getItem(AGENDA_VIEW_KEY) === 'blocks' ? 'blocks' : 'list' } catch { return 'list' }
  })
  return [view, next => {
    setView(next)
    try { window.localStorage.setItem(AGENDA_VIEW_KEY, next) } catch { /* 沒有 localStorage 就只記在這次 */ }
  }]
}

function AgendaPanel({ agenda, calendar, now, onDropTask }: {
  agenda: AgendaItem[]
  calendar: ReturnType<typeof useCalendarEvents>
  now: Date
  onDropTask: (dragKey: string, time: string) => void
}) {
  const t = useTranslations('today')
  const [view, setView] = useAgendaView()
  const [showPast, setShowPast] = useState(false)
  const past = agenda.filter(item => item.state === 'past')
  const visible = showPast ? agenda : agenda.filter(item => item.state !== 'past')
  // 「現在」線：放在進行中的項目之後；沒有進行中的就放在下一個項目之前；都過了就放最後
  const currentIndex = visible.findIndex(item => item.state === 'now')
  const nextIndex = visible.findIndex(item => item.state === 'upcoming')
  const markerAt = currentIndex >= 0 ? currentIndex + 1 : nextIndex >= 0 ? nextIndex : visible.length
  const nowMarker = (
    <li key="now-line" className="grid grid-cols-[44px_16px_1fr] items-center gap-2 text-xs font-semibold text-primary" aria-hidden>
      <span className="text-right tabular-nums">{hhmm(now.getTime())}</span>
      <span className="col-span-2 h-px bg-primary/50" />
    </li>
  )
  const rows: React.ReactNode[] = visible.map(item => <AgendaRow key={item.key} item={item} />)
  rows.splice(markerAt, 0, nowMarker)

  return (
    <section className="rounded-xl bg-background p-4" aria-labelledby="today-agenda">
      <header className="mb-2.5 flex items-center gap-2.5">
        <h2 id="today-agenda" className="text-[15px] font-semibold">{t('agenda.title')}</h2>
        <div className="ml-auto flex rounded-lg bg-muted p-0.5" role="group" aria-label={t('agenda.view')}>
          {(['list', 'blocks'] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                'flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground',
                view === option && 'bg-background text-foreground shadow-sm',
              )}
            >
              {option === 'list' ? <List className="size-3.5" aria-hidden /> : <Rows3 className="size-3.5" aria-hidden />}
              {t(`agenda.${option}`)}
            </button>
          ))}
        </div>
      </header>
      <p className="-mt-1.5 mb-2 text-xs text-muted-foreground">{t('agenda.sources')}</p>

      {(calendar.access === 'notDetermined' || calendar.access === 'denied') && (
        <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2 text-sm">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{calendar.access === 'denied' ? t('calendar.denied') : t('calendar.prompt')}</span>
          {calendar.access === 'notDetermined' && (
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void calendar.requestAccess()}>{t('calendar.connect')}</Button>
          )}
        </div>
      )}

      {view === 'blocks' && <TimeBlocks agenda={agenda} now={now} onDropTask={onDropTask} />}

      {view === 'list' && past.length > 0 && (
        <button type="button" className="cursor-pointer pb-2 pl-[68px] text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowPast(value => !value)} aria-expanded={showPast}>
          {showPast ? t('agenda.hidePast') : t('agenda.showPast', { count: past.length })}
        </button>
      )}

      {view === 'list' && (agenda.length === 0
        ? <p className="py-6 text-center text-sm text-muted-foreground">{t('agenda.empty')}</p>
        : (
          <ol className="relative before:absolute before:top-2 before:bottom-2 before:left-[51px] before:w-px before:bg-border">
            {rows}
          </ol>
        ))}
    </section>
  )
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const t = useTranslations('today')
  return (
    <li className="relative grid grid-cols-[44px_16px_minmax(0,1fr)] items-start gap-2 py-2">
      <time className={cn('pt-px text-right text-sm tabular-nums', item.state === 'past' ? 'text-muted-foreground/80' : 'text-muted-foreground')}>{hhmm(item.start)}</time>
      <span
        className={cn(
          'relative z-10 mt-1.5 ml-0.5 size-[11px] rounded-full border-2',
          item.state === 'now' ? 'border-primary bg-primary shadow-[0_0_0_4px] shadow-primary/15'
            : item.state === 'past' ? 'border-muted-foreground/60 bg-muted-foreground/60'
              : 'border-muted-foreground/60 bg-background',
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div className={cn('[overflow-wrap:anywhere]', item.state === 'now' && 'font-semibold', item.state === 'past' && 'text-muted-foreground')}>{item.title}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {item.kind === 'task' ? <Clock className="size-3" aria-hidden /> : item.kind === 'calendar' ? <CalendarDays className="size-3" aria-hidden /> : null}
          {t(`agenda.kind.${item.kind}`)}
          {item.kind === 'calendar' && item.source ? ` · ${item.source}` : ''}
          {item.kind === 'task' ? ` · ${item.source.split('/').pop()}` : ''}
          {item.state === 'now' ? ` · ${t('agenda.until', { time: hhmm(item.end), minutes: item.minutesLeft })}` : ''}
        </div>
        {item.state === 'now' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-muted" role="progressbar" aria-label={item.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
            <div className="h-full rounded bg-primary" style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
        )}
      </div>
    </li>
  )
}

function Tile({ icon, value, label, detail, warn, action }: {
  icon: React.ReactNode
  value: string
  label: string
  detail: string
  warn?: boolean
  action?: { label: string, onClick: () => void }
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-background px-4 py-3.5">
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground', warn && 'bg-primary/10 text-primary')}>{icon}</span>
      <div className="min-w-0">
        <div><b className="text-lg tabular-nums">{value}</b> <span className="text-sm">{label}</span></div>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {action && (
        <button type="button" className="ml-auto cursor-pointer whitespace-nowrap text-sm underline underline-offset-4 hover:text-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
