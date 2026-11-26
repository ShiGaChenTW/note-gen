'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import emitter from '@/lib/emitter'
import { PendingSyncDeletionsPanel } from './pending-sync-deletions'
import {
  emptyAppTrash,
  listTrashItems,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from '@/lib/trash/runtime'
import { getTrashRemainingDays, type TrashEntityType, type TrashItem } from '@/lib/trash/types'
import { cn } from '@/lib/utils'

type TrashCategory = 'all' | 'notes' | 'canvas' | 'records' | 'conversations' | 'memories'

const CATEGORY_ORDER: TrashCategory[] = [
  'all',
  'notes',
  'canvas',
  'records',
  'conversations',
  'memories',
]

function matchesCategory(entityType: TrashEntityType, category: TrashCategory): boolean {
  switch (category) {
    case 'all':
      return true
    case 'notes':
      return entityType === 'file' || entityType === 'folder'
    case 'canvas':
      return entityType === 'canvas'
    case 'records':
      return entityType === 'mark' || entityType === 'tag' || entityType === 'source'
    case 'conversations':
      return entityType === 'conversation'
    case 'memories':
      return entityType === 'memory'
  }
}

async function syncStoresAfterRestore(entityType: TrashEntityType): Promise<void> {
  try {
    if (entityType === 'file' || entityType === 'folder') {
      const { default: useArticleStore } = await import('@/stores/article')
      await useArticleStore.getState().loadFileTree?.()
      return
    }
    if (entityType === 'canvas') {
      const { default: useCanvasStore } = await import('@/stores/canvas')
      await useCanvasStore.getState().loadProjects?.()
      return
    }
    if (entityType === 'mark') {
      const { default: useMarkStore } = await import('@/stores/mark')
      const state = useMarkStore.getState()
      await Promise.all([
        state.fetchMarks?.(),
        state.fetchMarkPreviews?.(true),
      ])
      return
    }
    if (entityType === 'tag') {
      const [{ default: useTagStore }, { default: useMarkStore }] = await Promise.all([
        import('@/stores/tag'),
        import('@/stores/mark'),
      ])
      await useTagStore.getState().fetchTags?.()
      await useMarkStore.getState().fetchMarks?.()
      return
    }
    if (entityType === 'conversation') {
      const { default: useChatStore } = await import('@/stores/chat')
      await useChatStore.getState().initConversations?.()
      return
    }
    if (entityType === 'memory') {
      const { default: useMemoriesStore } = await import('@/stores/memories')
      const state = useMemoriesStore.getState()
      await Promise.all([
        state.loadMemories?.(),
        state.loadStats?.(),
      ])
    }
  } catch {
    // Store refresh errors must not block restore confirmation feedback.
  }
}

export function RecentlyDeletedView({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations('settings.trash')
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<TrashCategory>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [emptying, setEmptying] = useState(false)
  const [pendingDeleteItem, setPendingDeleteItem] = useState<TrashItem | null>(null)
  const [emptyDialogOpen, setEmptyDialogOpen] = useState(false)

  const refreshItems = useCallback(async () => {
    try {
      const list = await listTrashItems()
      setItems(list)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshItems()
    const handleChanged = () => {
      void refreshItems()
    }
    emitter.on('trash-changed', handleChanged)
    return () => {
      emitter.off('trash-changed', handleChanged)
    }
  }, [refreshItems])

  const filteredItems = useMemo(
    () => items.filter(item => matchesCategory(item.entityType, category)),
    [items, category],
  )

  const handleRestore = async (item: TrashItem) => {
    setBusyId(item.id)
    try {
      const result = await restoreTrashItem(item.id)
      if (result.status === 'restored') {
        await syncStoresAfterRestore(item.entityType)
        if (result.renamed && result.restoredPath) {
          toast.success(t('toasts.restoredRenamed', { path: result.restoredPath }))
        } else {
          toast.success(t('toasts.restored', { title: item.title }))
        }
      } else if (result.status === 'missing') {
        toast.error(t('toasts.restoreMissing', { title: item.title }))
      } else {
        toast.error(t('toasts.restoreFailed'))
      }
      await refreshItems()
    } catch {
      toast.error(t('toasts.restoreFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handlePermanentDelete = async (item: TrashItem) => {
    setBusyId(item.id)
    try {
      const deleted = await permanentlyDeleteTrashItem(item.id)
      if (deleted) {
        toast.success(t('toasts.deletedPermanently', { title: item.title }))
      } else {
        toast.error(t('toasts.deleteFailed'))
      }
      await refreshItems()
    } catch {
      toast.error(t('toasts.deleteFailed'))
    } finally {
      setBusyId(null)
      setPendingDeleteItem(null)
    }
  }

  const handleEmptyTrash = async () => {
    setEmptying(true)
    try {
      const result = await emptyAppTrash()
      if (result.failedIds.length > 0) {
        toast.error(t('toasts.emptyFailed'))
      } else {
        toast.success(t('toasts.emptied', { count: result.deletedCount }))
      }
      await refreshItems()
    } catch {
      toast.error(t('toasts.emptyFailed'))
    } finally {
      setEmptying(false)
      setEmptyDialogOpen(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', mobile && 'gap-3')}>
      <PendingSyncDeletionsPanel onTrashUpdated={() => void refreshItems()} />

      <div className={cn(
        'flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between',
        mobile && 'p-3',
      )}>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('retentionNotice')}
        </p>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="shrink-0"
          disabled={items.length === 0 || emptying || busyId !== null}
          onClick={() => setEmptyDialogOpen(true)}
        >
          <Trash2 data-icon="inline-start" />
          {t('actions.emptyTrash')}
        </Button>
      </div>

      <Tabs value={category} onValueChange={value => setCategory(value as TrashCategory)}>
        <TabsList aria-label={t('tabsLabel')} className="h-auto w-full flex-wrap justify-start gap-1">
          {CATEGORY_ORDER.map(key => (
            <TabsTrigger key={key} value={key} className="flex-none px-2.5 py-1 text-xs">
              {t(`tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={category} className="mt-3">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
              <Trash2 className="mb-3 size-8 text-muted-foreground/50" aria-hidden />
              <p className="text-sm font-medium">{t('emptyTitle')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('emptyDescription')}</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              {t('emptyFiltered')}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {filteredItems.map(item => {
                const days = getTrashRemainingDays(item)
                const roleLabel = t(`actors.${item.actorRole}`)
                const actorLabel = item.actorRole === 'advisor'
                  && item.deletedBy
                  && item.deletedBy !== 'mcp'
                  && item.deletedBy !== 'advisor'
                  ? `${item.deletedBy} · ${roleLabel}`
                  : roleLabel
                const sourceLabel = t(`sources.${item.source}`)
                const typeLabel = t(`types.${item.entityType}`)

                return (
                  <li
                    key={item.id}
                    aria-label={item.title}
                    className={cn(
                      'flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between',
                      mobile && 'p-3',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        <Badge variant="secondary" className="text-[11px]">
                          {typeLabel}
                        </Badge>
                        <Badge variant="outline" className="text-[11px]">
                          {t('remainingDays', { days })}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{t('deletedBy', { actor: actorLabel })}</span>
                        <span>{t('sourceLabel', { source: sourceLabel })}</span>
                        {item.originalPath ? (
                          <span className="truncate">{t('pathLabel', { path: item.originalPath })}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className={cn('flex shrink-0 items-center gap-2', mobile && 'justify-end')}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId !== null || emptying}
                        onClick={() => void handleRestore(item)}
                      >
                        <RotateCcw data-icon="inline-start" />
                        {t('actions.restore')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busyId !== null || emptying}
                        onClick={() => setPendingDeleteItem(item)}
                      >
                        <Trash2 data-icon="inline-start" />
                        {t('actions.deletePermanently')}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={Boolean(pendingDeleteItem)}
        onOpenChange={open => { if (!open) setPendingDeleteItem(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteItem ? t('deleteDialog.description', { title: pendingDeleteItem.title }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDeleteItem) void handlePermanentDelete(pendingDeleteItem)
              }}
            >
              {t('deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={emptyDialogOpen} onOpenChange={setEmptyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('emptyDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('emptyDialog.description', { count: items.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('emptyDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleEmptyTrash()}
            >
              {t('emptyDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
