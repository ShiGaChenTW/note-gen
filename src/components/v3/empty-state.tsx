import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function EmptyState({ icon: Icon, text, action, className }: {
  icon?: ComponentType<{ className?: string }>
  text: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div data-slot="empty-state" className={cn('flex items-start justify-start gap-2 text-left text-ui-compact leading-5 text-muted-ink', className)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <p>{text}</p>
        {action}
      </div>
    </div>
  )
}
