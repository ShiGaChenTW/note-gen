'use client'

import type { ComponentProps } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const FOCUS = 'outline-none focus-visible:ring-1 focus-visible:ring-ring'
const BUTTON = 'h-7 shrink-0 cursor-pointer rounded-(--r) transition-colors duration-100 disabled:cursor-default disabled:opacity-50'

export function DateNavArrow({ direction, className, ...props }: ComponentProps<'button'> & { direction: 'previous' | 'next' }) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  return (
    <button type="button" className={cn(BUTTON, FOCUS, 'grid size-7 place-items-center text-muted-ink enabled:hover:bg-hover enabled:hover:text-ink', className)} {...props}>
      <Icon className="size-4" aria-hidden />
    </button>
  )
}

export function DateNavReset({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button type="button" className={cn(BUTTON, FOCUS, 'bg-hover px-2.5 text-ui-compact font-medium text-ink enabled:hover:bg-active', className)} {...props} />
  )
}

export function DateCell({ day, weekday, today, selected, hasContent, className, ...props }: Omit<ComponentProps<'button'>, 'children'> & {
  day: string
  weekday?: string
  today?: boolean
  selected?: boolean
  hasContent?: boolean
}) {
  return (
    <button
      type="button"
      aria-current={today ? 'date' : undefined}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-(--r) tabular-nums transition-colors duration-100',
        FOCUS,
        selected ? 'bg-active text-ink' : 'text-muted-ink hover:bg-hover',
        className,
      )}
      {...props}
    >
      <span aria-hidden data-date-today className={cn('mb-0.5 size-1 shrink-0 rounded-full', today && 'bg-current text-ink')} />
      <span data-date-number className={cn(selected ? 'font-semibold' : 'font-medium', today && 'text-ink')}>{day}</span>
      {weekday && <span className="mt-0.5 text-xs leading-4">{weekday}</span>}
      <span aria-hidden data-date-content className={cn('mt-0.5 size-[3px] shrink-0 rounded-full', hasContent && 'bg-current')} />
    </button>
  )
}
