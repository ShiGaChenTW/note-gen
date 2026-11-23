'use client'

// Fork（almanac ALMNC-69.2）：新增筆記提案上 Scott 改了標題或存放位置時，說明「原建議 → 你的修改」（11/22 決定）。
// 工作台卡片（接受前）與對話裡的提案卡（接受前後）共用；沒改過就不畫。差異的判斷在 lib/workbench/new-note.ts newNoteChanges。
import { useTranslations } from 'next-intl'
import type { Proposal } from '@/lib/collect/types'
import { cn } from '@/lib/utils'
import { newNoteChanges } from '@/lib/workbench/new-note'
import useDailySettingsStore from '@/stores/daily-settings'

export function NewNoteChanges({ proposal, className }: { proposal: Proposal, className?: string }) {
  const t = useTranslations('workbench.newNote')
  const inboxFolder = useDailySettingsStore(state => state.inboxFolder)
  const changes = newNoteChanges(proposal, inboxFolder)
  if (!changes) return null
  const dir = (folder: string) => folder || t('root')
  return (
    <div data-testid="new-note-changes" className={cn('text-xs text-muted-ink', className)}>
      <p className="text-faint">{t('changed')}</p>
      {changes.titleChange && <p className="break-words">{t('changedTitle', changes.titleChange)}</p>}
      {changes.folderChange && <p className="break-words">{t('changedFolder', { from: dir(changes.folderChange.from), to: dir(changes.folderChange.to) })}</p>}
    </div>
  )
}
