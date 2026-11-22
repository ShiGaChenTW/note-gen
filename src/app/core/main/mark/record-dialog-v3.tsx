'use client'

// Fork（almanac ALMNC-56 重跑稽核）：記錄／新增資料源對話框裡只在 V3 出現的部分，獨立成這個檔案，讓 V3 樣式 lint 掃得到
// （對話框本體 unified-record-dialog.tsx 新舊介面共用，classic 的樣子不動）。
// - 類型列：token 圓角與底色；選類型用 V3 的下拉選單（和對話頁、編輯區工具列一樣），不用原生 select。
// - 匯入 Email、會議逐字稿、訂閱 RSS 時的「處理中」狀態列。
// - 錄音中的停止鈕用 danger 色。
import type { ReactNode } from 'react'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** V3 錄音中停止鈕的顏色（classic 維持原本的紅色）。 */
export const V3_STOP_RECORDING_CLASS = 'text-danger hover:text-danger/80'

export type ImportBusyKind = 'email' | 'meeting' | 'rss'

/** 匯入或訂閱進行中：轉圈＋文字，讀屏會念出（role="status"）。 */
export function ImportProgress({ kind }: { kind: ImportBusyKind }) {
  const t = useTranslations('workbench.import.busy')
  return (
    <p role="status" aria-live="polite" data-testid="import-progress" className="flex items-center gap-2 text-ui-compact text-muted-ink">
      <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
      {t(kind)}
    </p>
  )
}

export interface TypeOption<T extends string> {
  value: T
  label: string
  shortcut: string
}

/** V3 的類型列：左邊是偵測／手動選的類型，右邊是選類型的下拉選單。 */
export function V3TypeRow<T extends string>({ icon, summary, value, options, label, disabled, onChange }: {
  icon: ReactNode
  summary: string
  value: T
  options: readonly TypeOption<T>[]
  label: string
  disabled?: boolean
  onChange: (value: T) => void
}) {
  const current = options.find(option => option.value === value)
  return (
    <div data-testid="record-type-row" className="flex flex-wrap items-center gap-3 rounded-(--r) bg-hover px-3 py-2 text-xs text-ink">
      <div className="flex min-w-0 items-center gap-2 font-medium [&_svg]:size-3.5">{icon}<span>{summary}</span></div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={label}
            data-testid="record-type-trigger"
            className={cn(
              'ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-(--r) border border-line bg-bg px-2 text-xs text-ink outline-none',
              'hover:bg-hover focus-visible:ring-1 focus-visible:ring-ink/60 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <span>{current?.label}</span>
            <span className="text-muted-ink tabular-nums">{current?.shortcut}</span>
            <ChevronDown aria-hidden className="size-3.5 text-muted-ink" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuRadioGroup value={value} onValueChange={next => onChange(next as T)}>
            {options.map(option => (
              <DropdownMenuRadioItem key={option.value} value={option.value} className="text-xs">
                {option.label}
                <DropdownMenuShortcut>{option.shortcut}</DropdownMenuShortcut>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
