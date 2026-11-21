'use client'

// Fork（almanac ALMNC-54.8）：審核分頁的一張卡（v14）。收合時一行：類型字（標籤＋動詞，不用圖示）｜標的物＋第二行｜誰建議的＋等多久；
// 點一下就地展開：內容、按鈕（依卡片類型）、右邊「先放著 S」。在檯面上的卡片標「檯面上」。
import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Clock, MessagesSquare } from 'lucide-react'
import { openConversation } from '@/lib/proposals/actions'
import { ACTION_KEY, actionForKey, actionLabelKey, ageParts, type CardAction, type WorkbenchCard } from '@/lib/workbench/cards'
import { reminderPresets } from '@/lib/workbench/put-aside'
import { cn } from '@/lib/utils'
import useChatStore from '@/stores/chat'
import { JobReviewPreview } from '../jobs/job-result'
import { DiffBlock, destinationText } from './decide-parts'
import { DiscussForm } from './discuss-form'

export const BTN = 'inline-flex h-[30px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg px-3 text-ui-compact font-medium text-ink outline-none transition-colors duration-100 hover:bg-hover focus-visible:ring-1 focus-visible:ring-ink/60 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_PRIMARY = 'border-invert bg-invert text-invert-ink hover:bg-invert/90'
export const KBD = 'inline-flex h-[18px] items-center rounded border border-current/25 px-1 font-mono text-[11px] leading-none opacity-70'

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={KBD}>{children}</kbd>
}

function Age({ card, now }: { card: WorkbenchCard, now: number }) {
  const t = useTranslations('workbench')
  const { unit, value } = ageParts(card.at, now)
  const age = t(`age.${unit}`, { count: value })
  return (
    <span className={cn('min-w-11 text-right font-mono text-[11.5px] text-faint tabular-nums', card.overdue && 'text-danger')}>
      {card.overdue ? t('overdue', { age }) : age}
    </span>
  )
}

function ConversationLink({ id }: { id: number }) {
  const t = useTranslations('decide')
  const title = useChatStore(state => state.conversations.find(entry => entry.id === id)?.title)
  return (
    <button
      type="button"
      data-testid="card-source-conversation"
      onClick={() => void openConversation(id)}
      className="mt-3 flex max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-ui-compact text-muted-ink outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-ring/65"
    >
      <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{t('discuss.fromConversation', { title: title || t('discuss.conversation') })}</span>
    </button>
  )
}

function CardBody({ card }: { card: WorkbenchCard }) {
  const t = useTranslations('workbench')
  const decideT = useTranslations('decide')
  const organizeT = useTranslations('organize')
  const item = card.decide
  if (item) {
    return (
      <div className="text-ui-compact leading-6 text-muted-ink">
        {item.preview.type === 'job'
          ? <JobReviewPreview criterion={item.preview.criterion} result={item.preview.result} />
          : <p>{t('writesTo', { dest: destinationText(decideT, item.preview) })}</p>}
        {item.organizeMerge && <p className="mt-2 text-ink">{organizeT('mergeEffect', item.organizeMerge)}</p>}
        {item.preview.diff && <DiffBlock diff={item.preview.diff} className="mt-2" />}
        {item.duplicates.length > 0 && <p className="mt-2 text-xs">{decideT('merged', { count: item.duplicates.length })}</p>}
      </div>
    )
  }
  if (card.kind === 'source') {
    return (
      <section className="rounded-lg border border-line-soft px-3 py-2 text-ui-compact" data-testid="card-judgement">
        <div className="flex items-baseline gap-2"><b className="font-semibold text-ink">{t('sources.judgement')}</b><span className="text-xs text-faint">{t('sources.judgementHint')}</span></div>
        <p className="mt-1 text-muted-ink">{t('sources.noJudgement')}</p>
      </section>
    )
  }
  if (card.kind === 'confirm') return <p className="text-ui-compact text-muted-ink">{t('confirmSince', { date: card.summary })}</p>
  if (card.notePaths?.length) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {card.notePaths.map(path => (
          <span key={path} title={path} className="rounded-md bg-hover px-2 py-0.5 text-xs text-muted-ink">{(path.split('/').pop() ?? path).replace(/\.md$/i, '')}</span>
        ))}
      </div>
    )
  }
  return null
}

function PutAsideChooser({ onPick, onCancel, now }: { onPick: (until?: string) => void, onCancel: () => void, now: number }) {
  const t = useTranslations('workbench.putAside')
  const presets = reminderPresets(now)
  const [date, setDate] = useState(presets.tomorrow)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-ui-compact" data-testid="put-aside-chooser" role="group" aria-label={t('entry')}>
      <button type="button" className={BTN} onClick={() => onPick()}>{t('noReminder')}</button>
      <button type="button" className={BTN} onClick={() => onPick(presets.tomorrow)}>{t('tomorrow')}</button>
      <button type="button" className={BTN} onClick={() => onPick(presets.nextWeek)}>{t('nextWeek')}</button>
      <label className="ml-1 flex items-center gap-1.5 text-muted-ink">
        <span>{t('pickDate')}</span>
        <input type="date" value={date} min={presets.tomorrow} onChange={event => setDate(event.target.value)} className="h-[30px] rounded-lg border border-line bg-bg px-2 text-ink" />
      </label>
      <button type="button" className={cn(BTN, BTN_PRIMARY)} disabled={!date} onClick={() => onPick(date)}>{t('set')}</button>
      <button type="button" className="ml-auto cursor-pointer text-muted-ink hover:text-ink" onClick={onCancel}>{t('back')}</button>
    </div>
  )
}

function ScheduleForm({ onSubmit, onCancel }: { onSubmit: (time: string) => void, onCancel: () => void }) {
  const t = useTranslations('workbench.schedule')
  const [time, setTime] = useState('09:00')
  return (
    <form className="mt-3 flex items-center gap-1.5 text-ui-compact" data-testid="schedule-form" onSubmit={event => { event.preventDefault(); if (time) onSubmit(time) }}>
      <label className="flex items-center gap-1.5 text-muted-ink">
        <span>{t('time')}</span>
        <input type="time" value={time} onChange={event => setTime(event.target.value)} className="h-[30px] rounded-lg border border-line bg-bg px-2 text-ink" />
      </label>
      <button type="submit" className={cn(BTN, BTN_PRIMARY)}>{t('confirm')}</button>
      <button type="button" className={BTN} onClick={onCancel}>{t('cancel')}</button>
    </form>
  )
}

export function ReviewCard({ card, now, current, expanded, leaving, onDesk, commanderName, onToggle, onAction, onPutAside }: {
  card: WorkbenchCard
  now: number
  current: boolean
  expanded: boolean
  leaving: boolean
  onDesk: boolean
  commanderName: string
  onToggle: () => void
  onAction: (action: CardAction, payload?: { note?: string, time?: string }) => void
  onPutAside: (until?: string) => void
}) {
  const t = useTranslations('workbench')
  const [mode, setMode] = useState<'none' | 'discuss' | 'aside' | 'schedule'>('none')

  function click(action: CardAction) {
    if (action === 'discuss') return setMode(value => value === 'discuss' ? 'none' : 'discuss')
    if (action === 'schedule') return setMode(value => value === 'schedule' ? 'none' : 'schedule')
    onAction(action)
  }

  return (
    <div
      role="option"
      aria-selected={current}
      data-expanded={expanded || undefined}
      data-testid="review-card"
      data-card={card.key}
      data-group={card.group}
      className={cn(
        'relative rounded-xl transition-[background,box-shadow,margin,opacity,transform] duration-200 ease-out',
        expanded && 'my-2 -mx-1.5 bg-bg shadow-float',
        leaving && 'translate-x-3 opacity-0',
      )}
    >
      <div
        onClick={onToggle}
        className={cn(
          'grid cursor-default grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl px-3 py-2.5',
          !expanded && 'hover:bg-hover',
          !expanded && (current || onDesk) && 'bg-active',
          expanded && 'px-4 pt-4 pb-1.5',
        )}
      >
        <span className="flex flex-col justify-center gap-px self-stretch border-r border-line pr-3 pl-1 whitespace-nowrap" data-testid="card-kind">
          <b className={cn('text-xs font-[650] tracking-[0.06em] text-muted-ink', (current || expanded) && 'text-ink')}>{t(`labels.${card.label}`)}</b>
          <i className="text-[11.5px] tracking-[0.02em] text-faint not-italic">{t(`verbs.${card.verb}`)}</i>
        </span>
        <span className="min-w-0">
          <span className={cn('block truncate text-sm font-medium text-ink', (current || onDesk) && 'font-semibold', expanded && 'text-base font-semibold tracking-[-0.01em] whitespace-normal')} data-testid="card-title">
            {card.title}
            {card.more ? <span className="ml-1.5 font-normal text-muted-ink">{t('more', { count: card.more })}</span> : null}
          </span>
          <span className="mt-px block truncate text-[12.5px] text-muted-ink" title={card.path}>
            {[card.path, card.kind === 'confirm' ? t('confirmSince', { date: card.summary }) : card.summary].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="flex items-center gap-3">
          {onDesk && <span className="rounded bg-hover px-1.5 text-[11px] text-ink" data-testid="card-on-desk">{t('onDesk')}</span>}
          {card.by && <span className="text-xs text-muted-ink">{card.by}</span>}
          <Age card={card} now={now} />
        </span>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pl-[18px]" data-testid="card-panel">
          <CardBody card={card} />
          {card.conversationId !== undefined && <ConversationLink id={card.conversationId} />}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {card.choices?.map((choice, index) => (
              <button key={choice} type="button" className={cn(BTN, index === 0 && BTN_PRIMARY)} onClick={() => onAction('pick', { note: choice })}>
                {choice}<Kbd>{index + 1}</Kbd>
              </button>
            ))}
            {card.actions.filter(action => action !== 'pick').map((action, index) => (
              <button
                key={action}
                type="button"
                data-action={action}
                aria-expanded={action === 'discuss' ? mode === 'discuss' : action === 'schedule' ? mode === 'schedule' : undefined}
                className={cn(BTN, index === 0 && !card.choices?.length && BTN_PRIMARY)}
                onClick={() => click(action)}
              >
                {t(`actions.${actionLabelKey(card, action)}`, { name: commanderName })}
                {ACTION_KEY[action] && actionForKey(card, ACTION_KEY[action]!) === action && <Kbd>{ACTION_KEY[action]}</Kbd>}
              </button>
            ))}
            <span className="flex-1" />
            <button
              type="button"
              data-action="putAside"
              aria-expanded={mode === 'aside'}
              onClick={() => setMode(value => value === 'aside' ? 'none' : 'aside')}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-ui-compact text-muted-ink outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60"
            >
              <Clock className="size-3.5" aria-hidden />{t('putAside.button')}<Kbd>S</Kbd>
            </button>
          </div>
          {mode === 'discuss' && (
            <DiscussForm className="mt-3" busy={false} onCancel={() => setMode('none')} onSubmit={note => { setMode('none'); onAction('discuss', { note }) }} />
          )}
          {mode === 'schedule' && <ScheduleForm onCancel={() => setMode('none')} onSubmit={time => { setMode('none'); onAction('schedule', { time }) }} />}
          {mode === 'aside' && <PutAsideChooser now={now} onCancel={() => setMode('none')} onPick={until => { setMode('none'); onPutAside(until) }} />}
        </div>
      )}
    </div>
  )
}
