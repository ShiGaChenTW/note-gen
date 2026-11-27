'use client'

// Fork（almanac ALMNC-90）：紀錄筆記（日誌筆記：frontmatter type: log，或舊值 record）開著時，編輯器工具列的「送給指揮官萃取」。
// 把這篇送成萃取資料源，指揮官只萃取知識筆記，以新增知識筆記提案進工作台、連回這篇（lib/workbench/record-extract.ts）。
// 重複送出不會產生重複提案：已有未處理提案、萃取中、內容沒變都不送，改用提示說明原因。知識、專案筆記沒有這顆按鈕。
import { useMemo, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ToolbarIconButton } from '@/components/v3/toolbar'
import { isRecordNote } from '@/lib/workbench/record-extract'
import { extractRecordNote } from './record-extract-io'

export function RecordExtractButton({ notePath, raw }: {
  notePath: string
  /** 編輯器裡 frontmatter 的原文（含前後 ---）。 */
  raw: string | null
}) {
  const t = useTranslations('editor.noteToolbar')
  const [busy, setBusy] = useState(false)
  const visible = useMemo(() => isRecordNote(raw), [raw])
  if (!visible || !notePath) return null
  const label = t('extractToCommander')

  async function send() {
    if (busy) return
    setBusy(true)
    try {
      const outcome = await extractRecordNote(notePath, t('saveBeforeSendFailed'))
      if (outcome === 'added') toast.success(t('extractSent'))
      else if (outcome === 'versioned') toast.success(t('extractNewVersion'))
      else if (outcome === 'pending') toast(t('extractPending'))
      else if (outcome === 'inProgress') toast(t('extractInProgress'))
      else if (outcome === 'unchanged') toast(t('extractUnchanged'))
      else toast(t('emptyNote'))
    } catch (error) {
      console.error('Failed to send record note for extraction:', error)
      toast.error(t('extractFailed'), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarIconButton aria-label={label} disabled={busy} onClick={() => void send()}>
            <Lightbulb />
          </ToolbarIconButton>
        </TooltipTrigger>
        <TooltipContent side="bottom"><p>{label}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
