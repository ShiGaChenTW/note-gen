'use client'

/**
 * 版本歷史面板（Issue #54）：桌面版才會出現在 FooterBar。顯示這篇筆記的本機 git 版本記錄
 * （ADR 0003），預設只顯示提示詞版本、可切換顯示自動快照；任選兩筆比較 diff；回復＝把舊內容
 * 寫回檔案並另外留一筆新版本（summary「回復到 X」），不會動到舊的 commit。
 *
 * 入口故意放在 FooterBar、跟 #56「確認為新版本」的頂部提示列分開，兩者不會搶同一塊版面。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { History, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getWorkspaceAbsolutePath } from '@/lib/workspace'
import { saveLocalFile } from '@/lib/sync/auto-sync'
import useArticleStore from '@/stores/article'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import {
  commitGitVersion,
  listGitVersionLog,
  showGitVersionFile,
} from '@/lib/git-versions/commands'
import { getGitVersionWorkspaceSettings } from '@/lib/git-versions/workspace-settings'
import type { GitVersionLogEntry } from '@/lib/git-versions/types'
import {
  buildRestoreCommitSummary,
  defaultShowAutoSnapshots,
  buildVersionDisplayLabel,
  filterVersionLogEntries,
  resolveDiffPair,
  toggleVersionSelection,
} from '@/lib/git-versions/version-history'
import { diffLines } from '@/lib/git-versions/diff-lines'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

interface VersionHistorySheetProps {
  editor: Editor
  prepareExternalAction?: () => boolean
  onMarkdownChange?: (markdown: string) => void
}

type DiffContents = { older: string | null; newer: string | null }

function kindLabel(
  t: ReturnType<typeof useTranslations>,
  kind: GitVersionLogEntry['kind'],
): string {
  if (kind === 'prompt-version') return t('kindPromptVersion')
  if (kind === 'auto-snapshot') return t('kindAutoSnapshot')
  return t('kindUnknown')
}

export function VersionHistorySheet({ editor, prepareExternalAction, onMarkdownChange }: VersionHistorySheetProps) {
  const t = useTranslations('versionHistory')
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const [open, setOpen] = useState(false)
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [versionControlEnabled, setVersionControlEnabled] = useState<boolean | null>(null)
  const [entries, setEntries] = useState<GitVersionLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [showAutoSnapshots, setShowAutoSnapshots] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [diffContents, setDiffContents] = useState<DiffContents | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const visibleEntries = useMemo(
    () => filterVersionLogEntries(entries, { showAutoSnapshots }),
    [entries, showAutoSnapshots],
  )
  const diffPair = useMemo(() => resolveDiffPair(selected, visibleEntries), [selected, visibleEntries])

  const loadHistory = useCallback(async (path: string, options: { resetFilter?: boolean } = {}) => {
    setLoading(true)
    setSelected([])
    setDiffContents(null)
    try {
      const root = await getWorkspaceAbsolutePath()
      setWorkspaceRoot(root)
      const settings = await getGitVersionWorkspaceSettings(root)
      setVersionControlEnabled(settings.enabled)
      if (!settings.enabled) {
        setEntries([])
        return
      }
      const log = await listGitVersionLog(root, { path })
      setEntries(log)
      if (options.resetFilter) setShowAutoSnapshots(defaultShowAutoSnapshots(log))
    } catch (error) {
      console.error('讀取版本歷史失敗:', error)
      toast({
        title: t('loadFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!open || !activeFilePath) return
    void loadHistory(activeFilePath, { resetFilter: true })
  }, [open, activeFilePath, loadHistory])

  useEffect(() => {
    if (!diffPair || !activeFilePath) {
      setDiffContents(null)
      return
    }
    const [older, newer] = diffPair
    let cancelled = false
    setDiffLoading(true)
    void (async () => {
      try {
        const [olderContent, newerContent] = await Promise.all([
          showGitVersionFile(workspaceRoot, older.id, activeFilePath),
          showGitVersionFile(workspaceRoot, newer.id, activeFilePath),
        ])
        if (cancelled) return
        setDiffContents({ older: olderContent, newer: newerContent })
      } catch (error) {
        if (cancelled) return
        console.error('讀取版本內容失敗:', error)
        toast({
          title: t('loadFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
        setDiffContents(null)
      } finally {
        if (!cancelled) setDiffLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [diffPair, activeFilePath, workspaceRoot, t])

  const diff = useMemo(() => {
    if (!diffContents || diffContents.older === null || diffContents.newer === null) return null
    return diffLines(diffContents.older, diffContents.newer)
  }, [diffContents])

  async function handleRestore(targetEntry: GitVersionLogEntry) {
    if (!activeFilePath || restoringId) return
    const content = await showGitVersionFile(workspaceRoot, targetEntry.id, activeFilePath)
    if (content === null) {
      toast({ title: t('versionUnavailable'), variant: 'destructive' })
      return
    }
    const label = buildVersionDisplayLabel(targetEntry)
    const confirmed = await confirm(
      t('restoreConfirmDesc', { label }),
      { title: t('restoreConfirmTitle'), kind: 'warning' },
    )
    if (!confirmed) return
    if (prepareExternalAction && !prepareExternalAction()) return

    setRestoringId(targetEntry.id)
    try {
      await useArticleStore.getState().flushPendingArticleSave(activeFilePath)
      await saveLocalFile(activeFilePath, content)
      if (onMarkdownChange) {
        onMarkdownChange(content)
      } else {
        editor.commands.clearContent()
        editor.commands.setContent(content, { contentType: 'markdown' })
      }

      const summary = buildRestoreCommitSummary(targetEntry)
      const commit = await commitGitVersion(workspaceRoot, summary, 'prompt-version', [activeFilePath])
      if (commit) {
        toast({ title: t('restoreSuccess'), description: t('restoreSuccessDesc', { label }) })
        await loadHistory(activeFilePath)
      } else {
        toast({ title: t('restoreNoChange') })
      }
    } catch (error) {
      console.error('回復版本失敗:', error)
      toast({
        title: t('restoreFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setRestoringId(null)
    }
  }

  if (!activeFilePath) return null
  const fileName = activeFilePath.split('/').pop() ?? activeFilePath

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-[hsl(var(--muted))]',
            open && 'bg-[hsl(var(--muted))]',
          )}
          title={t('footerButton')}
        >
          <History size={14} />
          <span>{t('footerButton')}</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-3/4 flex-col gap-0 data-[side=right]:w-[720px] data-[side=right]:sm:max-w-[720px]"
        onFocusOutside={(event) => event.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description', { fileName })}</SheetDescription>
        </SheetHeader>

        {versionControlEnabled === false ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-sm font-medium">{t('notEnabledTitle')}</div>
            <div className="text-sm text-muted-foreground">{t('notEnabledDesc')}</div>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false)
                useSettingsDialogStore.getState().openSettings('file')
              }}
            >
              {t('goToSettings')}
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  size="sm"
                  checked={showAutoSnapshots}
                  onCheckedChange={setShowAutoSnapshots}
                  aria-label={t('showAutoSnapshots')}
                />
                {t('showAutoSnapshots')}
              </label>
              <span className="text-xs text-muted-foreground">{t('selectedCount', { count: selected.length })}</span>
            </div>

            <ScrollArea className="h-[35%] min-h-[140px] rounded-md border">
              <div className="flex flex-col gap-1 p-2">
                {loading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">{t('loading')}</div>
                ) : visibleEntries.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</div>
                ) : (
                  visibleEntries.map((entry) => {
                    const isSelected = selected.includes(entry.id)
                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50',
                          isSelected && 'bg-muted',
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => setSelected(current => toggleVersionSelection(current, entry.id))}
                          aria-label={t('selectHint')}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm" title={entry.summary}>{entry.summary || entry.shortId}</span>
                            <Badge variant="outline" className="shrink-0">{kindLabel(t, entry.kind)}</Badge>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {entry.shortId} · {new Date(entry.timeSeconds * 1000).toLocaleString()}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={t('restore')}
                          aria-label={t('restore')}
                          disabled={restoringId !== null}
                          onClick={() => void handleRestore(entry)}
                        >
                          <RotateCcw className={cn(restoringId === entry.id && 'animate-spin')} />
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            </ScrollArea>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
              <div className="border-b bg-muted px-3 py-2 text-sm font-medium">{t('diffTitle')}</div>
              <ScrollArea className="flex-1">
                <div className="p-3 font-mono text-xs">
                  {!diffPair ? (
                    <div className="py-6 text-center text-muted-foreground">{t('diffEmpty')}</div>
                  ) : diffLoading ? (
                    <div className="py-6 text-center text-muted-foreground">{t('diffLoading')}</div>
                  ) : !diff ? (
                    <div className="py-6 text-center text-muted-foreground">{t('versionUnavailable')}</div>
                  ) : (
                    diff.map((line, index) => (
                      <div
                        key={index}
                        className={cn(
                          'whitespace-pre-wrap',
                          line.type === 'add' && 'bg-success/15 text-success-foreground',
                          line.type === 'remove' && 'bg-destructive/15 text-destructive',
                        )}
                      >
                        <span className="select-none text-muted-foreground">
                          {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                        </span>
                        {line.text}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default VersionHistorySheet
