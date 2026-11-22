'use client'

// Fork（almanac ALMNC-54.21）：新增筆記提案卡上的「標題」「存放位置」（定案文件第四節 4.23：顯示建議標題和建議存放位置，接受前可以直接改）。
// 改好離開欄位（或按 Enter）就存回收集 store 的那則提案；接受時照常寫入，寫的就是改過的值（lib/workbench/new-note.ts）。
// 欄位裡打字不會觸發工作台的單鍵（isEditableKeyboardTarget）。
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { V3_BUTTON_SHAPE } from '@/components/v3/button-shape'
import { checkNewNoteEdit, newNoteTarget } from '@/lib/workbench/new-note'
import { cn } from '@/lib/utils'
import useCollectStore from '@/stores/collect'
import useDailySettingsStore from '@/stores/daily-settings'

const INPUT = cn(V3_BUTTON_SHAPE, 'w-full min-w-0 border border-line bg-bg px-2 text-ui-compact text-ink outline-none focus-visible:ring-1 focus-visible:ring-ink/60')

/** 不是可以改的新增筆記（或提案已經不在）時顯示 fallback（原本的「接受後寫入：…」）。 */
export function NewNoteFields({ itemId, proposalId, fallback }: { itemId: string, proposalId: string, fallback?: ReactNode }) {
  const t = useTranslations('workbench.newNote')
  const id = useId()
  const proposal = useCollectStore(state => state.items.find(item => item.id === itemId)?.proposals.find(entry => entry.id === proposalId))
  const inboxFolder = useDailySettingsStore(state => state.inboxFolder)
  const target = proposal && proposal.status === 'wait' ? newNoteTarget(proposal, inboxFolder) : null
  const [title, setTitle] = useState(target?.title ?? '')
  const [folder, setFolder] = useState(target?.folder ?? '')

  useEffect(() => { void useDailySettingsStore.getState().initSettings() }, [])
  // 提案本身變了（存回去、設定讀好、重新提案）就跟著顯示。
  useEffect(() => {
    if (!target) return
    setTitle(target.title)
    setFolder(target.folder)
  }, [target?.title, target?.folder]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return <>{fallback}</>
  const checked = checkNewNoteEdit({ title, folder })
  const commit = () => {
    if (checked.ok) useCollectStore.getState().retarget(itemId, proposalId, checked.value, inboxFolder)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); commit() }
  }

  return (
    <div data-testid="new-note-fields" className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-ui-compact">
      <label htmlFor={`${id}-title`} className="text-muted-ink">{t('title')}</label>
      <input id={`${id}-title`} data-testid="new-note-title" value={title} onChange={event => setTitle(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} aria-invalid={!checked.ok || undefined} className={INPUT} />
      <label htmlFor={`${id}-folder`} className="text-muted-ink">{t('folder')}</label>
      <input id={`${id}-folder`} data-testid="new-note-folder" value={folder} placeholder={t('root')} onChange={event => setFolder(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} aria-invalid={!checked.ok || undefined} className={INPUT} />
      {checked.ok
        ? <p className="col-span-2 text-xs text-faint">{t('hint')}</p>
        : <p role="alert" className="col-span-2 text-xs text-danger">{t('invalid')}</p>}
    </div>
  )
}
