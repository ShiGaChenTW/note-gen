'use client'

// Fork（almanac ALMNC-54.8）：審核分頁的一張卡（v14）。收合時一行：類型字（標籤＋動詞，不用圖示）｜標的物＋第二行｜誰建議的＋等多久；
// 點一下就地展開：內容、按鈕（依卡片類型）、右邊「先放著 S」。在檯面上的卡片標「檯面上」。
import { BlueprintFields, DomainExpertOption } from './blueprint-fields'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight, Clock, MessagesSquare } from 'lucide-react'
import { openConversation } from '@/lib/proposals/actions'
import { ACTION_KEY, actionForKey, actionLabelKey, ageParts, proposalCard, type CardAction, type WorkbenchCard } from '@/lib/workbench/cards'
import { reminderPresets } from '@/lib/workbench/put-aside'
import { Kbd } from '@/components/ui/kbd'
import { KBD_ON_BUTTON, V3_BUTTON_SHAPE } from '@/components/v3/button-shape'
import { cn } from '@/lib/utils'
import useChatStore from '@/stores/chat'
import { JobReviewPreview } from '../jobs/job-result'
import type { DecideItem } from '@/lib/decide/project'
import { newNoteTarget } from '@/lib/workbench/new-note'
import useCollectStore from '@/stores/collect'
import useDailySettingsStore from '@/stores/daily-settings'
import useWorkbenchStore from '@/stores/workbench'
import { destinationText, DiffBlock } from './decide-parts'
import { DiscussForm } from './discuss-form'
import { NewNoteFields } from './new-note-fields'
import { ProposalChanges, RiskBadge } from './proposal-risk'
import { MAX_DOMAINS } from '@/lib/moc/membership'

// Fork（almanac ALMNC-56.6，V06）：工作台的按鈕和對話、收集同一個高度與圓角（V3_BUTTON_SHAPE）；
// 主要按鈕的顏色和 Button 的 default 一樣（V3 的 bg-primary 就是反白），不再手動加 bg-invert。
export const BTN = `${V3_BUTTON_SHAPE} inline-flex cursor-pointer items-center gap-2 border border-line bg-bg px-3 text-ui-compact font-medium text-ink outline-none transition-colors duration-100 hover:bg-hover focus-visible:ring-1 focus-visible:ring-ink/60 disabled:cursor-not-allowed disabled:opacity-50`
export const BTN_PRIMARY = 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80'

/** 按鈕裡的鍵盤提示（V15）：共用的 components/ui/kbd.tsx，顏色跟著按鈕。 */
export function ButtonKbd({ children }: { children: ReactNode }) {
  return <Kbd className={KBD_ON_BUTTON}>{children}</Kbd>
}

function Age({ card, now }: { card: WorkbenchCard, now: number }) {
  const t = useTranslations('workbench')
  // Fork（almanac ALMNC-54.21）：沒排日期的任務沒有「等多久」可算，只留欄寬。
  if (card.undated) return <span className="min-w-11" aria-hidden />
  const { unit, value } = ageParts(card.at, now)
  const age = t(`age.${unit}`, { count: value })
  return (
    <span className={cn('min-w-11 text-right font-mono text-ui-numeric text-faint tabular-nums', card.overdue && 'text-danger')}>
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
      className="mt-3 flex max-w-full cursor-pointer items-center gap-1.5 rounded-(--r-kbd) text-left text-ui-compact text-muted-ink outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-ring/65"
    >
      <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{t('discuss.fromConversation', { title: title || t('discuss.conversation') })}</span>
    </button>
  )
}

/**
 * Fork（almanac ALMNC-69.3）：指揮官判斷附的一行理由與信心，以及「判斷為日誌（信心高／低）」——
 * 寫在原本的分析結果卡上，不另外出卡；接受這張卡時一起貼日誌標籤。
 */
function VerdictLines({ item }: { item: NonNullable<WorkbenchCard['decide']> }) {
  const t = useTranslations('workbench.verdict')
  const journal = item.journalTag
  const rationale = item.rationale
  if (!journal && !rationale?.reason) return null
  return (
    <div className="mb-2 space-y-0.5" data-testid="card-verdict">
      {journal && (
        <p className="text-ink" data-testid="card-journal-verdict">
          <b className="font-semibold">{t('journal', { confidence: t(`confidence.${journal.confidence}`) })}</b>
          {journal.reason ? <span className="text-muted-ink">　{journal.reason}</span> : null}
        </p>
      )}
      {rationale?.reason && (
        <p className="text-xs" data-testid="card-rationale">
          {rationale.confidence
            ? t('rationaleWithConfidence', { reason: rationale.reason, confidence: t(`confidence.${rationale.confidence}`) })
            : t('rationale', { reason: rationale.reason })}
        </p>
      )}
    </div>
  )
}

type CardActionPayload = { note?: string, time?: string, itemKey?: string }

/** Fork（almanac ALMNC-65.2）：批次卡裡的一則：標題、存放位置（照 Scott 改過的值）；展開看內容、改標題與位置（沿用 NewNoteFields）；逐則接受／退回。 */
function BatchRow({ item, onAction }: { item: DecideItem, onAction: (action: 'accept' | 'drop') => void }) {
  const t = useTranslations('workbench')
  const [open, setOpen] = useState(Boolean(item.mocReview))
  const ref = item.ref.source === 'collect' ? item.ref : null
  const proposal = useCollectStore(state => ref ? state.items.find(entry => entry.id === ref.itemId)?.proposals.find(entry => entry.id === ref.proposalId) : undefined)
  const inboxFolder = useDailySettingsStore(state => state.inboxFolder)
  const leaving = useWorkbenchStore(state => state.leaving.includes(item.key))
  const target = proposal ? newNoteTarget(proposal, inboxFolder) : null
  return (
    <li data-testid="batch-item" data-item={item.key} className={cn('transition-opacity duration-200', leaving && 'opacity-0')}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          data-testid="batch-item-toggle"
          onClick={() => setOpen(value => !value)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-(--r-kbd) text-left outline-none focus-visible:ring-1 focus-visible:ring-ink/60"
        >
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-faint transition-transform duration-100', open && 'rotate-90')} />
          <span className="min-w-0">
            <span className="block truncate text-sm text-ink" data-testid="batch-item-title">{target?.title ?? item.title}</span>
            <span className="block truncate text-xs text-muted-ink" data-testid="batch-item-folder">{target ? target.folder || t('newNote.root') : ''}</span>
          </span>
        </button>
        <button type="button" className={BTN} data-batch-action="accept" onClick={() => onAction('accept')}>{t('batch.accept')}</button>
        <button type="button" className={BTN} data-batch-action="drop" onClick={() => onAction('drop')}>{t('batch.drop')}</button>
      </div>
      {open && (
        <div className="px-3 pb-3 pl-8" data-testid="batch-item-detail">
          {ref && target && <NewNoteFields itemId={ref.itemId} proposalId={ref.proposalId} />}
          {proposal?.body.trim()
            ? <div className="mt-2 max-h-64 overflow-y-auto rounded-(--r-kbd) border border-line-soft bg-bg px-3 py-2 text-ui-compact leading-6 whitespace-pre-wrap break-words text-ink" data-testid="batch-item-content">{proposal.body.trim()}</div>
            : null}
          {item.mocReview
            ? <ProposalChanges card={proposalCard(item, item.at)} item={item} />
            : !proposal?.body.trim() && item.preview.diff && <DiffBlock diff={item.preview.diff} className="mt-2" />}
        </div>
      )}
    </li>
  )
}

/** Fork（almanac ALMNC-65.2）：同一資料源的新知識筆記批次卡：判斷為日誌（有的話只寫一次）、每一則一列。 */
function BatchBody({ card, onAction }: { card: WorkbenchCard, onAction: (action: CardAction, payload?: CardActionPayload) => unknown }) {
  const t = useTranslations('workbench')
  const items = card.batch ?? []
  const journalItem = items.find(item => item.journalTag)
  return (
    <div className="text-ui-compact leading-6 text-muted-ink" data-testid="batch-body">
      {journalItem && <VerdictLines item={journalItem} />}
      <p>{t(items[0]?.mocReview ? 'batch.mocHeading' : 'batch.heading', { count: items.length })}</p>
      {journalItem && <p className="text-xs">{t('batch.journalOnce')}</p>}
      <ul className="mt-2 divide-y divide-line-soft rounded-(--r) border border-line-soft">
        {items.map(item => <BatchRow key={item.key} item={item} onAction={action => onAction(action, { itemKey: item.key })} />)}
      </ul>
    </div>
  )
}

function CardBody({ card, onAction }: { card: WorkbenchCard, onAction: (action: CardAction, payload?: CardActionPayload) => unknown }) {
  const t = useTranslations('workbench')
  const decideT = useTranslations('decide')
  const organizeT = useTranslations('organize')
  const item = card.decide
  if (card.kind === 'batch') return <BatchBody card={card} onAction={onAction} />
  if (item?.journalTag?.only) {
    // Fork（almanac ALMNC-69.3）：只貼日誌標籤的分析結果：沒有要寫的檔案，只說接受後會做什麼。
    return (
      <div className="text-ui-compact leading-6 text-muted-ink">
        <VerdictLines item={item} />
        <p className="mt-1">{t('verdict.journalOnly')}</p>
      </div>
    )
  }
  if (item) {
    return (
      <div className="text-ui-compact leading-6 text-muted-ink">
        <VerdictLines item={item} />
        {item.preview.type === 'job'
          ? <JobReviewPreview criterion={item.preview.criterion} result={item.preview.result} />
          : item.ref.source === 'collect' && (item.preview.type === 'newNote' || item.kind === 'create')
            // Fork（almanac ALMNC-54.21）：新增筆記可以先改標題和存放位置再接受。
            ? <NewNoteFields itemId={item.ref.itemId} proposalId={item.ref.proposalId} fallback={<p>{t('writesTo', { dest: destinationText(decideT, item.preview) })}</p>} />
            : <p>{t('writesTo', { dest: destinationText(decideT, item.preview) })}</p>}
        {item.organizeMerge && <p className="mt-2 text-ink">{organizeT('mergeEffect', item.organizeMerge)}</p>}
        {/* Fork（almanac ALMNC-65.1）：風險等級＋完整差異（沒有完整前後文時退回原本的 DiffBlock）。 */}
        <ProposalChanges card={card} item={item} />
        {item.duplicates.length > 0 && <p className="mt-2 text-xs">{decideT('merged', { count: item.duplicates.length })}</p>}
      </div>
    )
  }
  if (card.kind === 'source') {
    return (
      <section className="rounded-(--r) border border-line-soft px-3 py-2 text-ui-compact" data-testid="card-judgement">
        <div className="flex items-baseline gap-2"><b className="font-semibold text-ink">{t('sources.judgement')}</b><span className="text-xs text-faint">{t('sources.judgementHint')}</span></div>
        <p className="mt-1 text-muted-ink">{t('sources.noJudgement')}</p>
      </section>
    )
  }
  // Fork（almanac ALMNC-54.14）：舊筆記批次卡：進度條＋「已處理 M / N」，說明判斷不出來的會一包一包回到這裡。
  if (card.kind === 'legacy' && card.legacy) {
    const { processed, total } = card.legacy
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0
    return (
      <div className="text-ui-compact text-muted-ink" data-testid="legacy-progress">
        <div className="h-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={processed}>
          <div className="h-full bg-ink/60" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 tabular-nums">{t('legacy.progress', { done: processed, total })}</p>
        <p className="mt-1">{t('legacy.hint', { size: card.legacy.batchSize ?? 20 })}</p>
      </div>
    )
  }
  if (card.kind === 'confirm') return <p className="text-ui-compact text-muted-ink">{t('confirmSince', { date: card.summary })}</p>
  // Fork（almanac ALMNC-69.7）：超過上限卡：說明選了會怎樣（選項按鈕在下面，一個領域一個）。
  if (card.kind === 'domainLimit') return <p className="text-ui-compact leading-6 text-muted-ink" data-testid="domain-limit-body">{t('domainLimit.body', { limit: MAX_DOMAINS })}</p>
  if (card.blueprint) return <BlueprintFields proposal={card.blueprint} />
  if (card.notePaths?.length) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {card.notePaths.map(path => (
            <span key={path} title={path} className="rounded-(--r-kbd) bg-hover px-2 py-0.5 text-xs text-muted-ink">{(path.split('/').pop() ?? path).replace(/\.md$/i, '')}</span>
          ))}
        </div>
        {card.domainProposalId && card.domainExpertName && <DomainExpertOption id={card.domainProposalId} name={card.domainExpertName} />}
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
        <input type="date" value={date} min={presets.tomorrow} onChange={event => setDate(event.target.value)} className={cn(V3_BUTTON_SHAPE, 'border border-line bg-bg px-2 text-ink')} />
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
        <input type="time" value={time} onChange={event => setTime(event.target.value)} className={cn(V3_BUTTON_SHAPE, 'border border-line bg-bg px-2 text-ink')} />
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
  /** 「再次討論」用回傳值判斷有沒有送出（false＝沒送出，表單留著）；其他動作不看回傳值。 */
  onAction: (action: CardAction, payload?: CardActionPayload) => unknown
  onPutAside: (until?: string) => void
}) {
  const t = useTranslations('workbench')
  const [mode, setMode] = useState<'none' | 'discuss' | 'aside' | 'schedule'>('none')
  const panelRef = useRef<HTMLDivElement>(null)

  /** 關掉再次討論表單後，焦點回到「再次討論」按鈕；按鈕不在了就回到卡片的收合列（不掉到 body）。 */
  function closeDiscuss() {
    const card = panelRef.current?.closest<HTMLElement>('[data-testid="review-card"]')
    setMode('none')
    requestAnimationFrame(() => {
      if (!card?.isConnected) return
      const target = card?.querySelector<HTMLElement>('[data-action="discuss"]') ?? card?.querySelector<HTMLElement>('[data-card-toggle]')
      target?.focus()
    })
  }

  function click(action: CardAction) {
    if (action === 'discuss') return setMode(value => value === 'discuss' ? 'none' : 'discuss')
    if (action === 'schedule') return setMode(value => value === 'schedule' ? 'none' : 'schedule')
    onAction(action)
  }

  // Fork（almanac ALMNC-56.4，A04）：不用 listbox／option（option 裡的按鈕會被讀屏攤平）。每張卡是一個 listitem，
  // 收合列是真正的按鈕（aria-expanded），展開後的動作按鈕在它旁邊；j／k 移動時焦點跟著游標（roving tabindex），讀屏會念出目前那一張。
  return (
    <div
      role="listitem"
      data-expanded={expanded || undefined}
      data-testid="review-card"
      data-card={card.key}
      data-group={card.group}
      className={cn(
        'relative rounded-(--r-md) transition-[background,box-shadow,margin,opacity,transform] duration-200 ease-out',
        expanded && 'my-2 -mx-1.5 bg-bg shadow-float',
        leaving && 'translate-x-3 opacity-0',
      )}
    >
      <button
        type="button"
        data-workbench-item
        data-card-toggle
        tabIndex={current ? 0 : -1}
        aria-expanded={expanded}
        aria-current={current ? 'true' : undefined}
        onClick={onToggle}
        className={cn(
          'grid w-full cursor-default grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-(--r-md) px-3 py-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ink/60',
          !expanded && 'hover:bg-hover',
          !expanded && (current || onDesk) && 'bg-active',
          expanded && 'px-4 pt-4 pb-1.5',
        )}
      >
        <span className="flex flex-col justify-center gap-px self-stretch border-r border-line pr-3 pl-1 whitespace-nowrap" data-testid="card-kind">
          <b className={cn('text-xs font-semibold text-muted-ink', (current || expanded) && 'text-ink')}>{t(`labels.${card.label}`)}</b>
          <i className="text-ui-numeric text-faint not-italic">{t(`verbs.${card.verb}`)}</i>
        </span>
        <span className="min-w-0">
          <span className={cn('block truncate text-sm font-medium text-ink', (current || onDesk) && 'font-semibold', expanded && 'text-base font-semibold whitespace-normal')} data-testid="card-title">
            {card.title}
            {card.more ? <span className="ml-1.5 font-normal text-muted-ink">{t('more', { count: card.more })}</span> : null}
          </span>
          <span className="mt-px block truncate text-xs text-muted-ink" title={card.path}>
            {[card.path, card.kind === 'confirm' ? t('confirmSince', { date: card.summary }) : card.summary].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="flex items-center gap-3">
          {onDesk && <span className="rounded-(--r) bg-hover px-1.5 text-ui-numeric text-ink" data-testid="card-on-desk">{t('onDesk')}</span>}
          <RiskBadge card={card} />
          {card.by && <span className="text-xs text-muted-ink">{card.by}</span>}
          <Age card={card} now={now} />
        </span>
      </button>
      {expanded && (
        <div ref={panelRef} className="px-4 pb-4 pl-[18px]" data-testid="card-panel">
          <CardBody card={card} onAction={onAction} />
          {card.conversationId !== undefined && <ConversationLink id={card.conversationId} />}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {card.choices?.map((choice, index) => (
              <button key={choice} type="button" className={cn(BTN, index === 0 && BTN_PRIMARY)} onClick={() => onAction('pick', { note: choice })}>
                {choice}<ButtonKbd>{index + 1}</ButtonKbd>
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
                {ACTION_KEY[action] && actionForKey(card, ACTION_KEY[action]!) === action && <ButtonKbd>{ACTION_KEY[action]}</ButtonKbd>}
              </button>
            ))}
            <span className="flex-1" />
            <button
              type="button"
              data-action="putAside"
              aria-expanded={mode === 'aside'}
              onClick={() => setMode(value => value === 'aside' ? 'none' : 'aside')}
              className="flex cursor-pointer items-center gap-1.5 rounded-(--r-kbd) px-1.5 text-ui-compact text-muted-ink outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60"
            >
              <Clock className="size-3.5" aria-hidden />{t('putAside.button')}<ButtonKbd>S</ButtonKbd>
            </button>
          </div>
          {mode === 'discuss' && (
            <DiscussForm
              className="mt-3"
              onCancel={closeDiscuss}
              onSubmit={async note => {
                if (await onAction('discuss', { note }) === false) return false
                closeDiscuss()
                return true
              }}
            />
          )}
          {mode === 'schedule' && <ScheduleForm onCancel={() => setMode('none')} onSubmit={time => { setMode('none'); onAction('schedule', { time }) }} />}
          {mode === 'aside' && <PutAsideChooser now={now} onCancel={() => setMode('none')} onPick={until => { setMode('none'); onPutAside(until) }} />}
        </div>
      )}
    </div>
  )
}
