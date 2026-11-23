'use client'

// Fork（almanac ALMNC-56 重跑稽核）：記錄／新增資料源對話框裡只在 V3 出現的部分，獨立成這個檔案，讓 V3 樣式 lint 掃得到
// （對話框本體 unified-record-dialog.tsx 新舊介面共用，classic 的樣子不動）。
// - 類型列：token 圓角與底色；選類型用 V3 的下拉選單（和對話頁、編輯區工具列一樣），不用原生 select。
// - 匯入 Email、會議逐字稿、訂閱 RSS 時的「處理中」狀態列。
// - 錄音中的停止鈕用 danger 色。
// - 新增資料源貼的是連結時的「稍後讀」（ALMNC-46 AC #6）。
// - 新增資料源的「這是日誌」與「新增文件」（ALMNC-69.3）。
import { useState, type ReactNode } from 'react'
import { BookmarkPlus, ChevronDown, FilePen, LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
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

/**
 * Fork（almanac ALMNC-46 AC #6，Q17 定案）：新增資料源貼的是連結時，「稍後讀」把連結加進稍後讀清單，不建資料源。
 * 加入成功提示並呼叫 onAdded（對話框清空並關閉）；同一網址已在清單只提示，對話框留著（還可以改存成資料源）。
 */
export function ReadLaterButton({ url, disabled, onAdded }: { url: string, disabled?: boolean, onAdded: () => void }) {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { addToReadLater } = await import('@/stores/read-later')
      const result = await addToReadLater(url)
      if (result === 'added') {
        toast({ title: t('settings.eink.readLater.added') })
        onAdded()
      } else if (result === 'duplicate') {
        toast({ title: t('settings.eink.readLater.duplicate') })
      } else {
        toast({ title: t('settings.eink.readLater.invalid'), variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: t('common.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button type="button" variant="outline" disabled={disabled || busy} data-testid="record-read-later" onClick={() => void save()}>
      <BookmarkPlus />{t('workbench.import.readLater')}
    </Button>
  )
}

/**
 * Fork（almanac ALMNC-69.3，Q9、Q13）：新增資料源對話框的兩個起點選項——
 * 「這是日誌」勾選框（Scott 勾了直接生效），和「新增文件」（打開編輯器自己寫，按「完成」才交給指揮官）。
 */
export function SourceStartOptions({ journal, journalAvailable = true, onJournalChange, onNewDocument, commanderName, disabled }: {
  journal: boolean
  /** 日誌只對文字有意義（連結、待辦、媒體不帶標籤）；不是文字時勾選框停用。 */
  journalAvailable?: boolean
  onJournalChange: (journal: boolean) => void
  onNewDocument: () => void
  commanderName: string
  disabled?: boolean
}) {
  const t = useTranslations('workbench.add')
  return (
    <div data-testid="source-start-options" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-(--r) border border-line-soft px-3 py-2 text-ui-compact">
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
        <Checkbox
          checked={journal && journalAvailable}
          disabled={disabled || !journalAvailable}
          data-testid="source-journal-checkbox"
          aria-describedby="source-journal-hint"
          className="mt-0.5"
          onCheckedChange={value => onJournalChange(value === true)}
        />
        <span className="min-w-0">
          <span className="font-medium text-ink">{t('journal')}</span>
          <span id="source-journal-hint" className="block text-xs text-muted-ink">{t('journalHint')}</span>
        </span>
      </label>
      <Button type="button" variant="outline" size="sm" disabled={disabled} data-testid="source-new-document" title={t('newDocHint', { name: commanderName })} onClick={onNewDocument}>
        <FilePen />{t('newDoc')}
      </Button>
    </div>
  )
}
