'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Segment<Value extends string> {
  value: Value
  label: ReactNode
  disabled?: boolean
}

export function Segmented<Value extends string>({
  items, value, onChange, label, title, kind = 'mode', compact, disabled, className,
}: {
  items: readonly Segment<Value>[]
  value: Value
  onChange: (value: Value) => void
  label: string
  title?: string
  kind?: 'mode' | 'tabs'
  compact?: boolean
  disabled?: boolean
  className?: string
}) {
  const tabs = kind === 'tabs'
  const enabled = disabled ? [] : items.filter(item => !item.disabled)
  const tabStop = enabled.find(item => item.value === value) ?? enabled[0]

  function move(event: KeyboardEvent<HTMLButtonElement>, current: Value) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return
    const index = enabled.findIndex(item => item.value === current)
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const direction = rtl ? -1 : 1
    let nextIndex: number
    switch (event.key) {
      case 'ArrowLeft': nextIndex = index - direction; break
      case 'ArrowRight': nextIndex = index + direction; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = enabled.length - 1; break
      default: return
    }
    const next = enabled[(nextIndex + enabled.length) % enabled.length]
    if (!next) return
    event.preventDefault()
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    const target = enabled.indexOf(next)
    buttons?.[target]?.focus()
    // Page tabs open another surface. Let Enter or Space activate after moving focus.
    if (!tabs && value !== next.value) onChange(next.value)
  }

  return (
    <div
      role={tabs ? 'tablist' : 'group'}
      aria-label={label}
      title={title}
      className={cn('inline-flex w-max shrink-0 items-stretch gap-0.5 rounded-(--r) bg-sunken p-0.5', compact ? 'h-[22px]' : 'h-6', className)}
    >
      {items.map(item => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role={tabs ? 'tab' : undefined}
            aria-selected={tabs ? selected : undefined}
            aria-pressed={tabs ? undefined : selected}
            disabled={disabled || item.disabled}
            tabIndex={item === tabStop ? 0 : -1}
            className={cn(
              'inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[4px] border border-transparent px-2 text-xs leading-none whitespace-nowrap outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              selected ? 'border-line bg-bg font-semibold text-ink' : 'text-muted-ink enabled:hover:text-ink',
            )}
            onClick={() => { if (!selected) onChange(item.value) }}
            onKeyDown={event => move(event, item.value)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
