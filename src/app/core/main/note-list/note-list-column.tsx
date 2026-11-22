'use client'

// Fork（almanac ALMNC-54.17）：V3「我的筆記」的中間欄。點側欄「我的筆記」或其中的資料夾時出現，
// 列出該資料夾（含子資料夾）的筆記，最近修改的在上（編輯區工具列置頂的排最前面）；點一列在右邊編輯器打開，開著的那篇標成選中。
// 其他 V3 頁面（今天、工作台、對話⋯⋯）打開時由 linkExclusiveOverlays 收起，classic 不顯示。
import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useUiV3 } from '@/lib/fork-ui'
import { buildNoteList, folderName, relativeTimeLabel, useNoteListStore } from '@/lib/note-list/note-list'
import { noteMarksWorkspaceKey } from '@/lib/note-toolbar/note-marks'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useNoteMarksStore, { selectWorkspaceMarks } from '@/stores/note-marks'
import useSettingStore from '@/stores/setting'
import useVaultIndexStore from '@/stores/vault-index'
import { SIDEBAR_ROW } from '../sidebar-row'
import { useVaultName } from '../sidebar-v3/use-vault-name'

/** 每分鐘重算一次相對時間（「現在」→「1 分鐘前」）。 */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function NoteListColumn() {
  const isV3 = useUiV3()
  const visible = useNoteListStore(state => state.visible)
  if (!isV3 || !visible) return null
  return <NoteList />
}

function NoteList() {
  const t = useTranslations('sidebarV3')
  const locale = useLocale()
  const folder = useNoteListStore(state => state.folder)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const now = useNow()
  // 編輯區工具列「置頂」的筆記排最上面（stores/note-marks，每個工作區一份）。
  const workspaceKey = noteMarksWorkspaceKey(useSettingStore(state => state.workspacePath))
  const pinned = useNoteMarksStore(state => selectWorkspaceMarks(state, 'pinned', workspaceKey))
  useEffect(() => { void useNoteMarksStore.getState().load() }, [])
  const items = useMemo(
    () => buildNoteList(notes.values(), folder, pinned),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes, revision, folder, pinned],
  )
  // ALMNC-43.12：根目錄標題與根目錄筆記的位置都用筆記庫名稱（和側欄檔案樹標題同一個）。
  const vaultName = useVaultName()
  const title = folder ? folderName(folder) : vaultName

  return (
    <aside
      aria-label={t('noteList.label', { folder: title })}
      className="flex h-full w-[280px] shrink-0 flex-col border-r border-line-soft bg-background"
      data-note-list
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-soft px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={folder || title}>{title}</h2>
        <span className="shrink-0 text-xs tabular-nums text-faint" aria-label={t('count', { count: items.length })}>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-ink">
          <FileText className="size-5 opacity-60" aria-hidden />
          <p>{t('noteList.empty')}</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" role="list">
          {items.map(item => {
            const selected = item.path === activeFilePath
            const meta = [item.folder || vaultName, relativeTimeLabel(item.mtime, now, locale)].filter(Boolean).join(' · ')
            return (
              <li key={item.path}>
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => { if (!selected) void useArticleStore.getState().setActiveFilePath(item.path) }}
                  className={cn(SIDEBAR_ROW, 'flex w-full flex-col items-stretch gap-0.5 px-3 py-2 text-left text-ink', selected && 'bg-active')}
                >
                  <span className="truncate text-sm leading-5 font-semibold" title={item.title}>{item.title}</span>
                  <span className="truncate text-xs leading-4 text-muted-ink" title={item.folder || undefined}>{meta}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
