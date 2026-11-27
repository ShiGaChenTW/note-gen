'use client'

// Fork（almanac ALMNC-85.3，第 8 節 3A）：同步確認卡。只有 Scott 能改的文字（Scott 的偏好、soul.md、rules.md）兩台都改了同一段時，
// 同步照常進行、這台的版本先留著，另一台的版本也存著；這張卡讓 Scott 挑：用這台的、用另一台的、自己合併。
// 每一段衝突並排顯示兩台的寫法（同 UndoCompareCard 的兩欄樣式）。SyncConflictCards 掛在工作台最上面，沒有卡就不佔位置。
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'
import { listSyncConflictsForUi, resolveSyncConflictForUi } from '@/lib/almanac-sync/conflict-actions'
import type { ConflictChoice, SyncConflict } from '@/lib/almanac-sync/tables/conflicts'

function Lines({ label, lines }: { label: string, lines: readonly string[] }) {
  return (
    <div role="group" aria-label={label} className="min-w-0 flex-1 rounded-md border border-line bg-bg">
      <div className="border-b border-line px-2 py-1 text-xs font-medium">{label}</div>
      <pre className="max-h-48 overflow-auto p-2 font-mono text-xs whitespace-pre-wrap break-all">
        {lines.length ? lines.map((line, index) => <div key={index}>{line || ' '}</div>) : null}
      </pre>
    </div>
  )
}

export function SyncConflictCard({ conflict, busy, onChoose }: { conflict: SyncConflict, busy?: boolean, onChoose: (choice: ConflictChoice) => void }) {
  const t = useTranslations('workbench.syncConflict')
  const [merging, setMerging] = useState(false)
  const [draft, setDraft] = useState(conflict.keptLocal)
  const subject = conflict.subject === 'preferences'
    ? t('subject.preferences')
    : t(`subject.${conflict.subject}`, { name: conflict.agentName ?? t('unknownAgent') })
  const title = t('title', { subject })
  const hunks = conflict.hunks.length ? conflict.hunks : [{ base: [], local: conflict.local.split('\n'), remote: conflict.remote.split('\n') }]

  return (
    <section role="region" aria-label={title} className="space-y-3 rounded-md border border-line bg-panel p-3 text-sm text-ink">
      <div>
        <div className="font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      {hunks.map((hunk, index) => (
        <div key={index} className="flex flex-col gap-2 sm:flex-row">
          <Lines label={t('local')} lines={hunk.local} />
          <Lines label={t('remote')} lines={hunk.remote} />
        </div>
      ))}
      {merging ? (
        <div className="space-y-2">
          <textarea
            aria-label={t('mergedLabel')}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            rows={8}
            className="w-full rounded-md border border-line bg-bg p-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => onChoose({ kind: 'merged', text: draft })}>{t('saveMerged')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setMerging(false); setDraft(conflict.keptLocal) }}>{t('cancel')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onChoose({ kind: 'local' })}>{t('useLocal')}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onChoose({ kind: 'remote' })}>{t('useRemote')}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setMerging(true)}>{t('merge')}</Button>
        </div>
      )}
    </section>
  )
}

const keyOf = (conflict: Pick<SyncConflict, 'tableName' | 'syncKey' | 'field'>) => `${conflict.tableName}:${conflict.syncKey}:${conflict.field}`

/** 工作台：列出還沒處理的確認卡（同步後有新卡會重新載入）。 */
export function SyncConflictCards() {
  const t = useTranslations('workbench.syncConflict')
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    try {
      setConflicts(await listSyncConflictsForUi())
    } catch (error) {
      console.debug('[almanac-sync] conflicts unavailable:', error)
    }
  }, [])

  useEffect(() => {
    void reload()
    const handler = () => void reload()
    emitter.on('almanac-sync-conflicts-changed', handler)
    return () => emitter.off('almanac-sync-conflicts-changed', handler)
  }, [reload])

  async function choose(conflict: SyncConflict, choice: ConflictChoice) {
    setBusy(keyOf(conflict))
    setFailed(false)
    try {
      await resolveSyncConflictForUi({ tableName: conflict.tableName, syncKey: conflict.syncKey, field: conflict.field }, choice)
    } catch (error) {
      console.error('[almanac-sync] resolve conflict failed:', error)
      setFailed(true)
    } finally {
      setBusy(null)
      await reload()
    }
  }

  if (!conflicts.length) return null
  return (
    <div className="space-y-2 px-1 pb-3">
      {failed && <p role="alert" className="text-xs text-destructive">{t('failed')}</p>}
      {conflicts.map(conflict => (
        <SyncConflictCard key={keyOf(conflict)} conflict={conflict} busy={busy === keyOf(conflict)} onChoose={choice => void choose(conflict, choice)} />
      ))}
    </div>
  )
}
