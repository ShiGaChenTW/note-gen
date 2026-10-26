'use client'

// Fork（#53）：行動版的提示詞庫——瀏覽與取用，沒有庫頁的管理功能（新增、搬移未納入的筆記走桌面版）。
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { getPromptUsageMap, type PromptUsage } from '@/db/prompt-usage'
import { collectPromptNotes, promptTitle, sortPromptNotes } from '@/lib/prompt-library/prompt-note'
import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore from '@/stores/vault-index'
import { PromptDetailPanel } from '@/app/core/main/prompt-library/prompt-detail-panel'

export default function MobilePromptsPage() {
  const t = useTranslations('promptLibrary')
  const router = useRouter()
  const promptFolder = useDailySettingsStore(state => state.promptFolder)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const [usage, setUsage] = useState<Map<string, PromptUsage>>(new Map())
  const [search, setSearch] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    void getPromptUsageMap().then(setUsage)
  }, [])

  const promptNotes = useMemo(
    () => collectPromptNotes(notes.values(), promptFolder),
    [notes, revision, promptFolder], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = query
      ? promptNotes.filter(note => promptTitle(note).toLowerCase().includes(query) || note.tags.some(tag => tag.toLowerCase().includes(query)))
      : promptNotes
    return sortPromptNotes(list, usage, 'recentlyUsed')
  }, [promptNotes, search, usage])

  async function openNote(path: string) {
    await useArticleStore.getState().setActiveFilePath(path)
    router.push('/mobile/writing')
  }

  if (selectedPath) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-background">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <button type="button" aria-label={t('back')} onClick={() => setSelectedPath(null)}>
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <span className="truncate text-sm font-semibold">{t('title')}</span>
        </div>
        <div className="relative min-h-0 flex-1">
          <PromptDetailPanel path={selectedPath} onOpenNote={() => void openNote(selectedPath)} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <button type="button" aria-label={t('back')} onClick={() => router.back()}>
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <span className="truncate text-sm font-semibold">{t('title')}</span>
      </div>
      <div className="border-b p-3">
        <Input
          value={search}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          onChange={event => setSearch(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : filtered.map(note => (
          <button
            key={note.path}
            type="button"
            className="flex w-full flex-col gap-1 border-b px-3 py-3 text-left active:bg-muted/60"
            onClick={() => setSelectedPath(note.path)}
          >
            <span className="truncate text-sm font-medium">{promptTitle(note)}</span>
            {note.tags.length > 0 && (
              <div className="flex gap-1.5 text-xs text-muted-foreground">
                {note.tags.slice(0, 3).map(tag => <span key={tag} className="rounded bg-muted px-1.5 py-0.5">{tag}</span>)}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
