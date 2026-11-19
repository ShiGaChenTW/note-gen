'use client'

// Fork（almanac ALMNC-23）：今天主畫面上方的日期列。大數字＋星期，一次約兩週，可往前往後翻。
// v5 視覺（單色）：今天＝粗體＋數字下方短底線；選中日＝反白底（bg-invert，和 v5 的 .thread.on／.ditem.on 同一種選取）；
// 有日記＝星期下方一顆小點。鍵盤：左右鍵移動、Enter／空白鍵選取、Home／End 到窗口頭尾，焦點環用 ring-ring。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { DateCell, DateNavArrow, DateNavReset } from '@/components/v3/date-navigation'
import { toDateKey } from '@/lib/daily/format'
import { cn } from '@/lib/utils'
import { useDateFormats } from '@/lib/date-format'
import {
  addDaysLocal,
  buildDateStrip,
  dateFromDayKey,
  defaultStripStart,
  ensureStripVisible,
  shiftStripStart,
} from '@/lib/today-v3/date-strip'

export function DateStrip({ todayKey, selectedKey, noteKeys, onSelect, onToday }: {
  todayKey: string
  selectedKey: string
  noteKeys: ReadonlySet<string>
  onSelect: (key: string) => void
  onToday: () => void
}) {
  const t = useTranslations('todayV3.strip')
  const dates = useDateFormats()
  const [start, setStart] = useState(() => defaultStripStart(dateFromDayKey(selectedKey)))
  // roving tabindex：整排只有一個停靠點（預設選中日），左右鍵移動焦點
  const [focusKey, setFocusKey] = useState(selectedKey)
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef(false)

  const days = useMemo(() => buildDateStrip({ start, selectedKey, todayKey, noteKeys }), [start, selectedKey, todayKey, noteKeys])
  const first = days[0]
  const last = days[days.length - 1]
  const tabStop = days.some(day => day.key === focusKey) ? focusKey : first.key

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
    setFocusKey(toDateKey(target))
    pendingFocus.current = true
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
    const current = dateFromDayKey(tabStop)
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
  const range = dates.shortRange(first.date, last.date)
  const todayStart = defaultStripStart(dateFromDayKey(todayKey))
  const atToday = selectedKey === todayKey && start.getTime() === todayStart.getTime()
  const reset = () => {
    setStart(todayStart)
    setFocusKey(todayKey)
    onToday()
  }

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line-soft px-5 py-2" data-testid="today-v3-date-strip">
      <DateNavArrow direction="previous" aria-label={t('previous')} onClick={() => page(-1)} />
      <div role="group" aria-label={t('label', { range })} onKeyDown={onKeyDown} className="scrollbar-hide flex min-w-0 flex-1 justify-between gap-0.5 overflow-x-auto p-px">
        {days.map(day => (
          <DateCell
            key={day.key}
            ref={node => { if (node) refs.current.set(day.key, node); else refs.current.delete(day.key) }}
            day={dates.dayNumber(day.date)}
            weekday={dates.weekday(day.date)}
            today={day.isToday}
            selected={day.isSelected}
            hasContent={day.hasNote}
            tabIndex={day.key === tabStop ? 0 : -1}
            aria-pressed={day.isSelected}
            aria-label={[dates.full(day.date), day.isToday && t('today'), day.hasNote && t('hasNote')].filter(Boolean).join(', ')}
            data-key={day.key}
            data-today={day.isToday || undefined}
            data-note={day.hasNote || undefined}
            onClick={() => { setFocusKey(day.key); onSelect(day.key) }}
            onFocus={() => setFocusKey(day.key)}
            className="h-[58px] min-w-6 flex-1 text-ui-emphasis leading-5"
          />
        ))}
      </div>
      <DateNavArrow direction="next" aria-label={t('next')} onClick={() => page(1)} />
      <span className="ml-1 w-[100px] shrink-0 text-right text-[11px] whitespace-nowrap text-muted-ink tabular-nums" aria-hidden>{range}</span>
      {/* 已經在看今天、日期列也停在今天這兩週時不需要「回到今天」；保留位置避免版面跳動 */}
      <DateNavReset
        onClick={reset}
        tabIndex={atToday ? -1 : 0}
        aria-hidden={atToday || undefined}
        className={cn('ml-1', atToday && 'invisible')}
      >{t('backToToday')}</DateNavReset>
    </div>
  )
}
