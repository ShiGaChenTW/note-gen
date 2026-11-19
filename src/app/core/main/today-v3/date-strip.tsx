'use client'

// Fork（almanac ALMNC-23）：今天主畫面上方的日期列。大數字＋星期，一次約兩週，可往前往後翻。
// v5 視覺（單色）：今天＝粗體＋數字下方短底線；選中日＝反白底（bg-invert，和 v5 的 .thread.on／.ditem.on 同一種選取）；
// 有日記＝星期下方一顆小點。鍵盤：左右鍵移動、Enter／空白鍵選取、Home／End 到窗口頭尾，焦點環用 ring-ring。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  addDaysLocal,
  buildDateStrip,
  dateFromDayKey,
  defaultStripStart,
  ensureStripVisible,
  shiftStripStart,
} from '@/lib/today-v3/date-strip'

const NAV_BUTTON = 'grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors duration-100 outline-none hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ring'

export function DateStrip({ todayKey, selectedKey, noteKeys, onSelect, onToday }: {
  todayKey: string
  selectedKey: string
  noteKeys: ReadonlySet<string>
  onSelect: (key: string) => void
  onToday: () => void
}) {
  const t = useTranslations('todayV3.strip')
  const weekdayT = useTranslations('todayV3.weekday')
  const [start, setStart] = useState(() => defaultStripStart(dateFromDayKey(selectedKey)))
  // roving tabindex：整排只有一個停靠點（預設選中日），左右鍵移動焦點
  const [focusKey, setFocusKey] = useState(selectedKey)
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef(false)

  const days = useMemo(() => buildDateStrip({ start, selectedKey, todayKey, noteKeys }), [start, selectedKey, todayKey, noteKeys])
  const first = days[0]
  const last = days[days.length - 1]

  // 外部換了選中日（例如「回到今天」）：窗口跟過去、停靠點跟著選中日
  useEffect(() => {
    setStart(current => {
      const target = dateFromDayKey(selectedKey)
      // 選中日跑出窗口（例如回到今天）：回到預設窗口；還看得到就不動
      return ensureStripVisible(current, target) === current ? current : defaultStripStart(target)
    })
    setFocusKey(selectedKey)
  }, [selectedKey])

  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    refs.current.get(focusKey)?.focus()
  }, [focusKey, start])

  const moveFocus = useCallback((target: Date) => {
    setStart(current => ensureStripVisible(current, target))
    setFocusKey(`${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`)
    pendingFocus.current = true
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
    const current = dateFromDayKey(focusKey)
    let target: Date | null = null
    if (event.key === 'ArrowLeft') target = addDaysLocal(current, -1)
    else if (event.key === 'ArrowRight') target = addDaysLocal(current, 1)
    else if (event.key === 'Home') target = first.date
    else if (event.key === 'End') target = last.date
    if (!target) return
    event.preventDefault()
    moveFocus(target)
  }

  const page = (direction: -1 | 1) => setStart(current => shiftStripStart(current, direction))
  const range = `${first.date.getMonth() + 1}/${first.day} – ${last.date.getMonth() + 1}/${last.day}`

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line-soft px-5 py-2" data-testid="today-v3-date-strip">
      <button type="button" className={NAV_BUTTON} aria-label={t('previous')} onClick={() => page(-1)}><ChevronLeft className="size-4" aria-hidden /></button>
      <div role="group" aria-label={t('label', { range })} onKeyDown={onKeyDown} className="scrollbar-hide flex min-w-0 flex-1 justify-between gap-0.5 overflow-x-auto p-px">
        {days.map(day => {
          const weekday = weekdayT(String(day.weekday))
          const label = t('dayLabel', { month: day.date.getMonth() + 1, day: day.day, weekday })
          return (
            <button
              key={day.key}
              ref={node => { if (node) refs.current.set(day.key, node); else refs.current.delete(day.key) }}
              type="button"
              tabIndex={day.key === focusKey ? 0 : -1}
              aria-pressed={day.isSelected}
              aria-current={day.isToday ? 'date' : undefined}
              aria-label={[label, day.isToday && t('today'), day.hasNote && t('hasNote')].filter(Boolean).join('，')}
              data-key={day.key}
              data-today={day.isToday || undefined}
              data-note={day.hasNote || undefined}
              onClick={() => { setFocusKey(day.key); onSelect(day.key) }}
              onFocus={() => setFocusKey(day.key)}
              className={cn(
                'flex h-[58px] min-w-6 flex-1 cursor-pointer flex-col items-center justify-center rounded-(--r) transition-colors duration-100 outline-none focus-visible:ring-1 focus-visible:ring-ring',
                day.isSelected ? 'bg-invert text-invert-ink' : 'text-muted-ink hover:bg-hover',
              )}
            >
              <span className={cn('font-mono text-[17px] leading-5 tabular-nums', day.isToday ? 'font-bold' : 'font-medium', !day.isSelected && day.isToday && 'text-ink')}>{day.day}</span>
              <span aria-hidden className={cn('h-0.5 w-3 rounded-full', day.isToday && 'bg-current')} />
              <span className="mt-0.5 text-xs leading-4">{weekday.replace(/^星期/, '')}</span>
              <span aria-hidden className={cn('mt-0.5 size-[3px] rounded-full', day.hasNote && 'bg-current')} />
            </button>
          )
        })}
      </div>
      <button type="button" className={NAV_BUTTON} aria-label={t('next')} onClick={() => page(1)}><ChevronRight className="size-4" aria-hidden /></button>
      <span className="ml-1 w-[100px] shrink-0 text-right font-mono text-[11px] whitespace-nowrap text-muted-ink" aria-hidden>{range}</span>
      <button
        type="button"
        onClick={onToday}
        tabIndex={selectedKey === todayKey ? -1 : 0}
        aria-hidden={selectedKey === todayKey}
        className={cn(
          'ml-1 h-7 shrink-0 cursor-pointer rounded-(--r) bg-hover px-2.5 text-[12.5px] font-medium text-ink transition-colors duration-100 outline-none hover:bg-active focus-visible:ring-1 focus-visible:ring-ring',
          selectedKey === todayKey && 'invisible',
        )}
      >{t('backToToday')}</button>
    </div>
  )
}
