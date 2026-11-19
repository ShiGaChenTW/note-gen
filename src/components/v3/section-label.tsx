import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SectionLabel({
  as: Tag = 'div', children, trailing, underline, latin, className,
}: {
  as?: 'div' | 'span' | 'h2' | 'h3'
  children?: ReactNode
  trailing?: ReactNode
  underline?: boolean
  latin?: boolean
  className?: string
}) {
  return (
    <Tag className={cn('flex min-w-0 items-center justify-between gap-2 text-xs leading-4 font-semibold text-muted-ink', underline && 'border-b border-line pb-1.5', className)}>
      <span className={cn('min-w-0', latin ? 'tracking-[0.08em] uppercase' : 'tracking-normal')}>{children}</span>
      {trailing}
    </Tag>
  )
}
