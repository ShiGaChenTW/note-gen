import { cn } from '@/lib/utils'

export function Count({ value, total, showZero, emphasis, max = 999, label }: {
  value: number
  /** When given, displays progress as value / total. */
  total?: number
  showZero?: boolean
  emphasis?: boolean
  max?: number
  label?: string
}) {
  const zero = (total ?? value) === 0
  if (zero && !showZero) return null

  return (
    <span className={cn(
      'inline-flex shrink-0 items-center rounded-[4px] px-1.5 font-mono text-ui-numeric leading-4 tabular-nums',
      zero ? 'text-faint' : 'bg-hover',
      emphasis && !zero ? 'font-semibold text-ink' : 'font-normal',
      !emphasis && !zero && 'text-muted-ink',
    )}>
      {/* 有 label 時讓螢幕閱讀器念 label（例如「4 件待整理」），數字本身只給眼睛看 */}
      <span aria-hidden={label ? true : undefined}>{total === undefined ? (value > max ? `${max}+` : value) : `${value} / ${total}`}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
