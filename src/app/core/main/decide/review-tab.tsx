'use client'

// Fork（almanac ALMNC-54.8）：工作台「審核」分頁（v14）。一條清單、不分區，依「等你回話／逾期／提案／要你親手整理」分組，
// 上方篩選：全部、日程、筆記、知識、資料源、回顧。就地展開決定，處理完收起、可以 Z 復原；先放著的入口在頁首右上角。
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { CARD_LABELS, filterCards, groupCards, labelCounts, type LabelFilter, type WorkbenchCard } from '@/lib/workbench/cards'
import type { ReviewData } from '@/lib/workbench/use-workbench'
import { cn } from '@/lib/utils'
import useWorkbenchStore from '@/stores/workbench'
import { BTN, Kbd } from './review-card'
import { ReviewCard } from './review-card'
import type { useCardActions } from './use-card-actions'

export function FilterPills<Value extends string>({ items, value, onChange, label, testId }: {
  items: ReadonlyArray<{ value: Value, label: string, count: number }>
  value: Value
  onChange: (value: Value) => void
  label: string
  testId?: string
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]" data-testid={testId}>
      {items.map(item => {
        const pressed = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={pressed}
            data-filter={item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-lg border border-line px-[11px] text-ui-compact text-muted-ink outline-none transition-colors duration-100 hover:border-ink/25 hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60',
              pressed && 'border-invert bg-invert font-semibold text-invert-ink hover:text-invert-ink',
            )}
          >
            {item.label}
            <span className={cn('text-xs tabular-nums text-faint', pressed && 'text-invert-ink/65')}>{item.count}</span>
          </button>
        )
      })}
    </div>
  )
}

function AsideList({ data }: { data: ReviewData }) {
  const t = useTranslations('workbench')
  const aside = useWorkbenchStore(state => state.aside)
  const takeBack = useWorkbenchStore(state => state.takeBack)
  return (
    <div className="mx-auto w-full max-w-[880px] px-7 py-5" data-testid="aside-list">
      <h2 className="mb-3 text-ui-compact font-semibold text-faint">{t('putAside.title')}</h2>
      {data.aside.length === 0 ? (
        <p className="text-ui-compact text-muted-ink">{t('putAside.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-px">
          {data.aside.map(card => (
            <li key={card.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3.5 rounded-xl px-3 py-2.5 hover:bg-hover" data-testid="aside-row">
              <span className="border-r border-line pr-3 text-xs font-[650] tracking-[0.06em] text-muted-ink">{t(`labels.${card.label}`)}</span>
              <span className="truncate text-sm text-ink">{card.title}</span>
              <span className="text-xs text-faint tabular-nums">{aside[card.key]?.until ? t('putAside.remindOn', { date: aside[card.key]!.until! }) : t('putAside.noDate')}</span>
              <button type="button" className={BTN} onClick={() => takeBack(card.key)}>{t('putAside.takeBack')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ReviewTab({ data, actions, commanderName }: {
  data: ReviewData
  actions: ReturnType<typeof useCardActions>
  commanderName: string
}) {
  const t = useTranslations('workbench')
  const filter = useWorkbenchStore(state => state.filter)
  const setFilter = useWorkbenchStore(state => state.setFilter)
  const cursor = useWorkbenchStore(state => state.cursor)
  const expanded = useWorkbenchStore(state => state.expanded)
  const leaving = useWorkbenchStore(state => state.leaving)
  const showAside = useWorkbenchStore(state => state.showAside)
  const deskCard = useWorkbenchStore(state => state.desk.cardKey)
  const setCursor = useWorkbenchStore(state => state.setCursor)
  const setExpanded = useWorkbenchStore(state => state.setExpanded)

  if (showAside) return <AsideList data={data} />

  const counts = labelCounts(data.visible)
  const visible = filterCards(data.visible, filter)
  const currentKey = cursor && visible.some(card => card.key === cursor) ? cursor : visible[0]?.key ?? null
  const filters: Array<{ value: LabelFilter, label: string, count: number }> = [
    { value: 'all', label: t('filter.all'), count: counts.all },
    ...CARD_LABELS.map(label => ({ value: label, label: t(`labels.${label}`), count: counts[label] })),
  ]

  function toggle(card: WorkbenchCard) {
    setCursor(card.key)
    setExpanded(expanded === card.key ? null : card.key)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-12">
        <div className="mx-auto w-full max-w-[880px] px-7 pt-5 pb-2.5">
          <FilterPills items={filters} value={filter} onChange={setFilter} label={t('filter.label')} testId="review-filters" />
        </div>
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 px-5 py-24 text-center" data-testid="review-empty">
            <span className="grid size-11 place-items-center rounded-full bg-hover text-brand"><Check className="size-5" aria-hidden /></span>
            <b className="text-[15px] font-semibold text-ink">{filter === 'all' ? t('empty') : t('emptyFiltered', { label: t(`labels.${filter}`) })}</b>
            <span className="text-ui-compact text-muted-ink">{t('emptyHint')}</span>
          </div>
        ) : (
          <div role="listbox" aria-label={t('listLabel')} className="mx-auto w-full max-w-[880px] px-5" data-testid="review-list" data-workbench-list>
            {groupCards(visible).map(({ group, cards }) => (
              <section key={group} aria-label={t(`groups.${group}`)}>
                <h3 className="flex items-baseline gap-2 px-3 pt-5 pb-2 text-xs font-semibold text-faint first:pt-1.5" data-testid="review-group">
                  {t(`groups.${group}`)}<span className="font-medium tabular-nums">{cards.length}</span>
                </h3>
                {cards.map(card => (
                  <ReviewCard
                    key={card.key}
                    card={card}
                    now={data.now}
                    current={card.key === currentKey}
                    expanded={card.key === expanded}
                    leaving={leaving.includes(card.key)}
                    onDesk={card.key === deskCard}
                    commanderName={commanderName}
                    onToggle={() => toggle(card)}
                    onAction={(action, payload) => void actions.run(card, action, payload)}
                    onPutAside={until => actions.putAside(card, until)}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-[18px] bg-linear-to-b from-transparent to-card to-40% p-2.5 text-xs text-faint max-md:hidden" data-testid="review-keys">
        <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd>{t('keys.select')}</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd>{t('keys.expand')}</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>A</Kbd>{t('keys.accept')}</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>S</Kbd>{t('keys.putAside')}</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>Z</Kbd>{t('keys.undo')}</span>
      </div>
    </div>
  )
}

/** 目前清單（套用篩選）與游標所在的卡片，給鍵盤用。 */
export function currentOf(data: ReviewData, filter: LabelFilter, cursor: string | null): { visible: WorkbenchCard[], current: WorkbenchCard | null } {
  const visible = filterCards(data.visible, filter)
  const current = visible.find(card => card.key === cursor) ?? visible[0] ?? null
  return { visible, current }
}
