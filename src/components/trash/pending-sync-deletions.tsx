'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Folder, FileText, Rss, Trash2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { listPendingSyncDeletions, type PendingSyncDeletion } from '@/db/sync-deletions'
import {
  confirmAllPendingSyncDeletions,
  confirmPendingSyncDeletion,
  rejectAllPendingSyncDeletions,
  rejectPendingSyncDeletion,
} from '@/lib/sync/deletion-tombstones'
import {
  confirmPendingRecordDeletion,
  listPendingRecordDeletionsForUi,
  rejectPendingRecordDeletion,
} from '@/lib/almanac-sync/pending-record-actions'
import type { PendingRecordDeletion } from '@/lib/almanac-sync/tables/pending-records'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import emitter from '@/lib/emitter'

function PendingSyncDeletionList({
  items,
  busyId,
  batchBusy,
  onConfirm,
  onReject,
}: {
  items: PendingSyncDeletion[]
  busyId: string | null
  batchBusy: boolean
  onConfirm: (item: PendingSyncDeletion) => void
  onReject: (item: PendingSyncDeletion) => void
}) {
  const t = useTranslations('settings.trash.syncDeletions')
  const disabled = busyId !== null || batchBusy

  return (
    <ul className="flex flex-col gap-2">
      {items.map(item => (
        <li
          key={item.id}
          aria-label={item.path}
          className="flex flex-col gap-2.5 rounded-md border bg-background/80 p-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {item.kind === 'folder'
                ? <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                : <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="truncate text-sm font-medium">{item.path}</span>
              <Badge variant="outline" className="text-[11px]">
                {t(item.kind === 'folder' ? 'folderBadge' : 'fileBadge')}
              </Badge>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onReject(item)}
            >
              <ShieldCheck data-icon="inline-start" />
              {t('reject')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={disabled}
              onClick={() => onConfirm(item)}
            >
              <Trash2 data-icon="inline-start" />
              {t('confirm')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Fork（almanac ALMNC-85.2，第 8 節 2A）：別台刪掉的資料庫列（RSS 訂閱）。跟檔案刪除放在同一份清單，多一個「設定與夥伴」分組。
 */
function PendingRecordDeletionGroup({
  items,
  busyId,
  batchBusy,
  onConfirm,
  onReject,
}: {
  items: PendingRecordDeletion[]
  busyId: string | null
  batchBusy: boolean
  onConfirm: (item: PendingRecordDeletion) => void
  onReject: (item: PendingRecordDeletion) => void
}) {
  const t = useTranslations('settings.trash.syncDeletions')
  if (items.length === 0) return null
  const disabled = busyId !== null || batchBusy
  const groupLabel = t('recordGroup')

  return (
    <div role="group" aria-label={groupLabel} className="flex flex-col gap-2">
      <h4 className="text-xs font-medium text-muted-foreground">{groupLabel}</h4>
      <ul className="flex flex-col gap-2">
        {items.map(item => (
          <li
            key={`${item.tableName}:${item.syncKey}`}
            aria-label={item.title}
            className="flex flex-col gap-2.5 rounded-md border bg-background/80 p-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Rss className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-sm font-medium">{item.title}</span>
              <Badge variant="outline" className="text-[11px]">{t('rssFeedBadge')}</Badge>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onReject(item)}>
                <ShieldCheck data-icon="inline-start" />
                {t('keepRecord')}
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={disabled} onClick={() => onConfirm(item)}>
                <Trash2 data-icon="inline-start" />
                {t('confirm')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const recordId = (item: PendingRecordDeletion) => `record:${item.tableName}:${item.syncKey}`

async function loadRecordDeletions(): Promise<PendingRecordDeletion[]> {
  try {
    return await listPendingRecordDeletionsForUi()
  } catch {
    return []
  }
}

/** 單筆與批次處理別台刪掉的資料庫列（Panel、Prompt 共用）。 */
function useRecordDeletionActions(reload: () => Promise<void>, setBusyId: (id: string | null) => void) {
  const t = useTranslations('settings.trash.syncDeletions')
  const confirmRecord = async (item: PendingRecordDeletion) => {
    setBusyId(recordId(item))
    try {
      await confirmPendingRecordDeletion(item.tableName, item.syncKey)
      toast.success(t('confirmedToast', { path: item.title }))
      await reload()
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBusyId(null)
    }
  }
  const rejectRecord = async (item: PendingRecordDeletion) => {
    setBusyId(recordId(item))
    try {
      await rejectPendingRecordDeletion(item.tableName, item.syncKey)
      toast.success(t('keptToast', { title: item.title }))
      await reload()
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBusyId(null)
    }
  }
  return { confirmRecord, rejectRecord }
}

async function confirmAllRecords(items: PendingRecordDeletion[]) {
  for (const item of items) await confirmPendingRecordDeletion(item.tableName, item.syncKey)
}

async function rejectAllRecords(items: PendingRecordDeletion[]) {
  for (const item of items) await rejectPendingRecordDeletion(item.tableName, item.syncKey)
}

export function PendingSyncDeletionsPanel({
  onTrashUpdated,
}: {
  onTrashUpdated?: () => void
}) {
  const t = useTranslations('settings.trash.syncDeletions')
  const [items, setItems] = useState<PendingSyncDeletion[]>([])
  const [records, setRecords] = useState<PendingRecordDeletion[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setItems(await listPendingSyncDeletions())
    } catch {
      setItems([])
    }
    setRecords(await loadRecordDeletions())
  }, [])
  const { confirmRecord, rejectRecord } = useRecordDeletionActions(refresh, setBusyId)

  useEffect(() => {
    void refresh()
    const handleChanged = () => { void refresh() }
    emitter.on('pending-sync-deletions-changed', handleChanged)
    return () => {
      emitter.off('pending-sync-deletions-changed', handleChanged)
    }
  }, [refresh])

  if (items.length === 0 && records.length === 0) return null

  const handleConfirm = async (item: PendingSyncDeletion) => {
    setBusyId(item.id)
    try {
      await confirmPendingSyncDeletion(item.id)
      toast.success(t('confirmedToast', { path: item.path }))
      await refresh()
      onTrashUpdated?.()
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (item: PendingSyncDeletion) => {
    setBusyId(item.id)
    try {
      await rejectPendingSyncDeletion(item.id)
      toast.success(t('rejectedToast', { path: item.path }))
      await refresh()
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleConfirmAll = async () => {
    setBatchBusy(true)
    try {
      await confirmAllPendingSyncDeletions()
      await confirmAllRecords(records)
      await refresh()
      onTrashUpdated?.()
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBatchBusy(false)
    }
  }

  const handleRejectAll = async () => {
    setBatchBusy(true)
    try {
      await rejectAllPendingSyncDeletions()
      await rejectAllRecords(records)
      await refresh()
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <section
      aria-label={t('title')}
      className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-card p-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={batchBusy || busyId !== null}
            onClick={() => void handleRejectAll()}
          >
            {t('rejectAll')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={batchBusy || busyId !== null}
            onClick={() => void handleConfirmAll()}
          >
            {t('confirmAll')}
          </Button>
        </div>
      </div>

      <PendingSyncDeletionList
        items={items}
        busyId={busyId}
        batchBusy={batchBusy}
        onConfirm={item => void handleConfirm(item)}
        onReject={item => void handleReject(item)}
      />
      <PendingRecordDeletionGroup
        items={records}
        busyId={busyId}
        batchBusy={batchBusy}
        onConfirm={item => void confirmRecord(item).then(() => onTrashUpdated?.())}
        onReject={item => void rejectRecord(item)}
      />
    </section>
  )
}

export function PendingSyncDeletionsPrompt() {
  const t = useTranslations('settings.trash.syncDeletions')
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const [items, setItems] = useState<PendingSyncDeletion[]>([])
  const [records, setRecords] = useState<PendingRecordDeletion[]>([])
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const reload = useCallback(async (openIfPending: boolean) => {
    try {
      const next = await listPendingSyncDeletions().catch(() => [] as PendingSyncDeletion[])
      const nextRecords = await loadRecordDeletions()
      setItems(next)
      setRecords(nextRecords)
      if (next.length === 0 && nextRecords.length === 0) setOpen(false)
      else if (openIfPending) setOpen(true)
    } catch {
      // DB might not be ready before initial bootstrap.
    }
  }, [])
  const reloadQuietly = useCallback(() => reload(false), [reload])
  const { confirmRecord, rejectRecord } = useRecordDeletionActions(reloadQuietly, setBusyId)

  useEffect(() => {
    void reload(true)
    const handleChanged = () => { void reload(true) }
    emitter.on('pending-sync-deletions-changed', handleChanged)
    return () => {
      emitter.off('pending-sync-deletions-changed', handleChanged)
    }
  }, [reload])

  const handleConfirm = async (item: PendingSyncDeletion) => {
    setBusyId(item.id)
    try {
      await confirmPendingSyncDeletion(item.id)
      toast.success(t('confirmedToast', { path: item.path }))
      await reload(false)
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (item: PendingSyncDeletion) => {
    setBusyId(item.id)
    try {
      await rejectPendingSyncDeletion(item.id)
      toast.success(t('rejectedToast', { path: item.path }))
      await reload(false)
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleConfirmAll = async () => {
    setBatchBusy(true)
    try {
      await confirmAllPendingSyncDeletions()
      await confirmAllRecords(records)
      await reload(false)
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBatchBusy(false)
    }
  }

  const handleRejectAll = async () => {
    setBatchBusy(true)
    try {
      await rejectAllPendingSyncDeletions()
      await rejectAllRecords(records)
      await reload(false)
    } catch {
      toast.error(t('actionFailed'))
    } finally {
      setBatchBusy(false)
    }
  }

  if (items.length === 0 && records.length === 0 && !open) return null

  const listNode = (
    <div className="flex flex-col gap-3">
      <PendingSyncDeletionList
        items={items}
        busyId={busyId}
        batchBusy={batchBusy}
        onConfirm={item => void handleConfirm(item)}
        onReject={item => void handleReject(item)}
      />
      <PendingRecordDeletionGroup
        items={records}
        busyId={busyId}
        batchBusy={batchBusy}
        onConfirm={item => void confirmRecord(item)}
        onReject={item => void rejectRecord(item)}
      />
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>{t('title')}</DrawerTitle>
            <DrawerDescription>{t('description')}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4">{listNode}</div>
          <DrawerFooter className="flex-col gap-2">
            <div className="grid w-full grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={batchBusy || busyId !== null} onClick={() => void handleRejectAll()}>
                {t('rejectAll')}
              </Button>
              <Button type="button" variant="destructive" disabled={batchBusy || busyId !== null} onClick={() => void handleConfirmAll()}>
                {t('confirmAll')}
              </Button>
            </div>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('later')}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto py-2">{listNode}</div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('later')}
          </Button>
          <Button type="button" variant="outline" disabled={batchBusy || busyId !== null} onClick={() => void handleRejectAll()}>
            {t('rejectAll')}
          </Button>
          <Button type="button" variant="destructive" disabled={batchBusy || busyId !== null} onClick={() => void handleConfirmAll()}>
            {t('confirmAll')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
