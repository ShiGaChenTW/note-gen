'use client'

// Fork（almanac ALMNC-54.8）：工作台「資料源」分頁（原收集箱，Q36；v14）。
// 左邊清單：上方只有狀態篩選（全部／等你決定／未整理／已整理／不採用），沒有輸入框和搜尋列；常駐勾選框＋全選，顯示「N / M 已整理」；
// 已整理的列有勾號與「N 則產出」。勾選後可以「交給 <指揮官本名> 整理」或「攤到檯面」。右邊讀原文、做決定；E 進整頁編輯器。
import { useTranslations } from 'next-intl'
import { ArrowLeft, Check, Lock } from 'lucide-react'
import { toast } from 'sonner'
import {
  SOURCE_FILTERS, dayBucket, filterCounts, filterRows, organisedSummary, pickState, toggleAll, togglePick, type SourceListRow,
} from '@/lib/workbench/sources-tab'
import { deleteFailedSource, handToCommander, processSource, rejectSource, restoreSource, retryCapture, sendToCommander } from '@/lib/workbench/actions'
import type { DeskMaterial } from '@/lib/workbench/desk'
import { cn } from '@/lib/utils'
import useWorkbenchStore from '@/stores/workbench'
import { BTN, BTN_PRIMARY, Kbd } from './review-card'
import { FilterPills } from './review-tab'
import { SourceEditor } from './source-editor'
import { useUndo } from './use-card-actions'

export function materialOf(row: SourceListRow): DeskMaterial {
  return { id: row.id, kind: row.origin, title: row.title, text: row.content, ...(row.sourceId ? { sourceId: row.sourceId } : {}) }
}

function Checkbox({ state, label, onClick }: { state: 'all' | 'some' | 'none' | boolean, label: string, onClick: () => void }) {
  const checked = state === true || state === 'all'
  const mixed = state === 'some'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label}
      onClick={event => { event.stopPropagation(); onClick() }}
      className="grid h-[22px] w-[30px] shrink-0 cursor-pointer place-items-center rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ink/60"
    >
      <span className={cn(
        'grid size-[15px] place-items-center rounded-[4px] border-[1.5px] border-ink/30 transition-colors duration-100',
        checked && 'border-ink bg-ink',
        mixed && 'border-ink',
      )}>
        {checked && <Check className="size-2.5 text-bg" strokeWidth={3} aria-hidden />}
        {mixed && <span className="h-0.5 w-[7px] bg-ink" />}
      </span>
    </button>
  )
}

function StatusTag({ status }: { status: SourceListRow['status'] }) {
  const t = useTranslations('workbench.sources.status')
  return (
    <span className={cn(
      'rounded-[5px] px-1.5 py-px text-[11px] whitespace-nowrap',
      status === 'wait' ? 'bg-invert text-invert-ink' : status === 'no' ? 'text-faint line-through' : 'bg-hover text-muted-ink',
    )} data-status={status}>{t(status)}</span>
  )
}

function Row({ row, selected, picked, onSelect, onPick }: { row: SourceListRow, selected: boolean, picked: boolean, onSelect: () => void, onPick: () => void }) {
  const t = useTranslations('workbench.sources')
  const done = row.status === 'done'
  const sub = done ? (row.outputs ? t('outputs', { count: row.outputs }) : t('noOutputs')) : row.status === 'edited' ? t('editedSub', { version: row.version }) : ''
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-row={row.id}
      data-testid="source-row"
      onClick={onSelect}
      className={cn('grid w-full cursor-default grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-1 rounded-[10px] py-2.5 pr-2.5 text-left hover:bg-hover', selected && 'bg-active')}
    >
      <Checkbox state={picked} label={t('pickRow', { title: row.title })} onClick={onPick} />
      <span className="self-stretch border-r border-line pt-0.5 pr-2 pl-1 text-[11.5px] leading-normal font-[650] tracking-[0.04em] whitespace-nowrap text-muted-ink">{t(`kind.${row.kind}`)}</span>
      <span className="min-w-0 pl-2">
        <span className={cn('flex items-center gap-1.5 truncate text-[13.5px] text-ink', done ? 'font-medium text-muted-ink' : 'font-semibold')}>
          {done && <Check className="size-3.5 shrink-0 text-brand" aria-hidden data-testid="row-done" />}
          <span className="truncate">{row.title}</span>
        </span>
        {row.excerpt && <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-normal text-muted-ink">{row.excerpt}</span>}
      </span>
      <span className="mt-0.5 flex flex-col items-end gap-0.5 pl-2.5">
        <StatusTag status={row.status} />
        {sub && <span className="text-[11.5px] whitespace-nowrap text-faint" data-testid="row-sub">{sub}</span>}
      </span>
    </div>
  )
}

function Detail({ row, commanderName, onDesk }: { row: SourceListRow, commanderName: string, onDesk: (rows: SourceListRow[]) => void }) {
  const t = useTranslations('workbench.sources')
  const toastT = useTranslations('workbench.toast')
  const setEditing = useWorkbenchStore(state => state.setEditing)
  const selectRow = useWorkbenchStore(state => state.selectRow)
  const undo = useUndo()

  /** 做動作；回傳函式的動作（例如不採用）可以復原。 */
  async function act(run: () => Promise<unknown>, message?: string) {
    try {
      const result = await run()
      const undoable = typeof result === 'function' ? result as () => Promise<unknown> : undefined
      if (!message) return
      useWorkbenchStore.getState().pushUndo({ message, undo: undoable })
      toast(message, undoable ? { action: { label: `${toastT('undo')} Z`, onClick: () => void undo() } } : undefined)
    } catch (error) {
      console.error('[workbench] source action failed:', error)
      toast.error(toastT('failed'))
    }
  }

  const sourceId = row.sourceId
  const editable = row.status !== 'ing'
  let actions: Array<{ key: string, label: string, primary?: boolean, kbd?: string, run: () => void }> = []
  if (row.status === 'wait' && sourceId && row.captureFailed) {
    // Fork（almanac ALMNC-54.10）：擷取失敗 → 重試／刪除（v14）。
    actions = [
      { key: 'retry', label: t('retry'), primary: true, kbd: 'R', run: () => void act(async () => {
        const judgement = await retryCapture(sourceId)
        toast(judgement?.status === 'capture_failed' ? toastT('retryFailed', { title: row.title }) : toastT('retried', { title: row.title }))
      }) },
      { key: 'delete', label: t('delete'), run: () => void act(async () => { await deleteFailedSource(sourceId); selectRow(null) }, toastT('deleted', { title: row.title })) },
    ]
  } else if (row.status === 'wait' && sourceId) {
    // Fork（almanac ALMNC-54.10）：照建議處理（帶初步判斷）／處理（不帶）都交給指揮官；先放著；不採用。沒有建議時只有「處理」。
    const putAside = () => {
      useWorkbenchStore.getState().putAside({ key: `source:${sourceId}`, title: row.title })
      toast(toastT('asided', { title: row.title }))
    }
    actions = [
      ...(row.suggestion
        ? [
            { key: 'process', label: t('process'), primary: true, kbd: 'A', run: () => void act(() => processSource(sourceId, { followSuggestion: true }), toastT('processed', { title: row.title, name: commanderName })) },
            { key: 'handle', label: t('handle'), run: () => void act(() => processSource(sourceId), toastT('processed', { title: row.title, name: commanderName })) },
          ]
        : [{ key: 'process', label: t('handle'), primary: true, kbd: 'A', run: () => void act(() => processSource(sourceId), toastT('processed', { title: row.title, name: commanderName })) }]),
      { key: 'putAside', label: t('putAside'), run: putAside },
      { key: 'reject', label: t('reject'), kbd: 'X', run: () => void act(() => rejectSource(sourceId), t('toast.rejected', { title: row.title })) },
    ]
  } else if (row.status === 'todo') {
    actions = [sourceId
      ? { key: 'send', label: t('send', { name: commanderName }), primary: true, run: () => void act(() => sendToCommander(sourceId), t('toast.sent', { name: commanderName, title: row.title })) }
      : { key: 'hand', label: t('handTo', { name: commanderName }), primary: true, run: () => void act(() => handToCommander([row]), t('toast.handed', { name: commanderName, count: 1 })) }]
  } else if (row.status === 'edited' && sourceId) {
    actions = [{ key: 'sendUpdate', label: t('sendUpdate', { name: commanderName }), primary: true, run: () => void act(() => sendToCommander(sourceId), t('toast.sent', { name: commanderName, title: row.title })) }]
  } else if (row.status === 'done') {
    actions = [
      { key: 'reorganise', label: t('reorganise'), run: () => void act(() => handToCommander([row]), t('toast.handedRe', { name: commanderName, count: 1, re: 1 })) },
      { key: 'desk', label: t('desk'), run: () => onDesk([row]) },
    ]
  } else if (row.status === 'no' && sourceId && row.origin === 'source') {
    actions = [{ key: 'restore', label: t('restore'), run: () => void act(() => restoreSource(sourceId), t('toast.restored', { title: row.title })) }]
  }
  const inJudgement = row.status === 'wait'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="source-detail">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-8 py-3.5 text-[12.5px] text-muted-ink max-md:px-4">
        <button type="button" aria-label={t('back')} onClick={() => selectRow(null)} className="grid size-7 cursor-pointer place-items-center rounded-md hover:bg-hover md:hidden"><ArrowLeft className="size-4" aria-hidden /></button>
        <span className="font-[650] tracking-[0.04em] text-ink">{t(`kind.${row.kind}`)}</span>
        <StatusTag status={row.status} />
        {row.version > 1 && <span className="tabular-nums">{t('version', { version: row.version })}</span>}
        <span className="flex-1" />
        {!inJudgement && actions.map(action => (
          <button key={action.key} type="button" data-source-action={action.key} className={cn(BTN, action.primary && BTN_PRIMARY)} onClick={action.run}>{action.label}{action.kbd && <Kbd>{action.kbd}</Kbd>}</button>
        ))}
        {editable && <button type="button" data-source-action="edit" className={BTN} onClick={() => setEditing(true)}>{t('edit')}<Kbd>E</Kbd></button>}
      </div>
      <article className="mx-auto w-full max-w-[720px] px-8 py-6 max-md:px-4">
        <h2 className="text-xl leading-7 font-semibold tracking-[-0.01em] break-words text-ink">{row.title}</h2>
        <div className="mt-1 flex flex-wrap gap-3 text-ui-compact text-muted-ink">
          {row.from && <span className="truncate">{row.from}</span>}
          <span className="tabular-nums">{new Date(row.at).toLocaleString()}</span>
        </div>
        {row.status === 'ing' && <p className="mt-4 rounded-lg bg-hover px-3 py-2 text-ui-compact text-muted-ink">{t('analysing', { name: commanderName })}</p>}
        {row.status === 'todo' && sourceId && <p className="mt-4 rounded-lg bg-hover px-3 py-2 text-ui-compact text-muted-ink">{t('queued', { name: commanderName })}</p>}
        {inJudgement && (
          <section className="mt-4 rounded-xl border border-line px-4 py-3" data-testid="source-judgement">
            <div className="flex items-baseline gap-2 text-ui-compact"><b className="font-semibold text-ink">{t('judgement')}</b><span className="text-xs text-faint">{t('judgementHint')}</span></div>
            <p className="mt-1.5 text-sm text-muted-ink" data-testid="judgement-line">
              {row.captureFailed ? t('captureFailedHint') : row.judgement ? <b className="font-medium text-ink">{row.judgement}</b> : t('noJudgement')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map(action => (
                <button key={action.key} type="button" data-source-action={action.key} className={cn(BTN, action.primary && BTN_PRIMARY)} onClick={action.run}>{action.label}{action.kbd && <Kbd>{action.kbd}</Kbd>}</button>
              ))}
            </div>
          </section>
        )}
        <div className="mt-5 text-sm leading-7 whitespace-pre-wrap break-words text-note-ink">{row.content}</div>
        {(row.status === 'done' || row.status === 'no') && (
          <p className="mt-6 flex items-center gap-1.5 text-xs text-faint"><Lock className="size-3.5" aria-hidden />{t('locked', { name: commanderName })}</p>
        )}
        {row.status === 'done' && row.outputs > 0 && (
          <p className="mt-4 text-ui-compact text-muted-ink"><b className="mr-2 font-semibold text-ink">{t('outputsTitle')}</b>{t('outputs', { count: row.outputs })}</p>
        )}
      </article>
    </div>
  )
}

export function SourcesTab({ rows, commanderName, onDesk }: { rows: SourceListRow[], commanderName: string, onDesk: (rows: SourceListRow[]) => void }) {
  const t = useTranslations('workbench.sources')
  const filter = useWorkbenchStore(state => state.sourceFilter)
  const setFilter = useWorkbenchStore(state => state.setSourceFilter)
  const picked = useWorkbenchStore(state => state.picked)
  const setPicked = useWorkbenchStore(state => state.setPicked)
  const selected = useWorkbenchStore(state => state.selectedRow)
  const selectRow = useWorkbenchStore(state => state.selectRow)
  const editing = useWorkbenchStore(state => state.editing)

  const visible = filterRows(rows, filter)
  const counts = filterCounts(rows)
  const summary = organisedSummary(rows)
  const ids = visible.map(row => row.id)
  const current = rows.find(row => row.id === selected) ?? null
  const pickedRows = rows.filter(row => picked.has(row.id))
  const now = Date.now()

  if (editing && current) return <SourceEditor row={current} commanderName={commanderName} />

  async function hand() {
    const list = pickedRows.filter(row => row.status !== 'ing')
    if (!list.length) return
    setPicked(new Set())
    try {
      const { count, reorganise } = await handToCommander(list)
      toast(reorganise ? t('toast.handedRe', { name: commanderName, count, re: reorganise }) : t('toast.handed', { name: commanderName, count }))
    } catch (error) {
      console.error('[workbench] hand to commander failed:', error)
    }
  }

  let lastBucket = ''
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[440px_minmax(0,1fr)]" data-testid="sources-tab">
      <div className={cn('relative flex min-h-0 flex-col overflow-y-auto border-r border-line-soft px-2.5 pt-3 pb-10', current && 'max-md:hidden')}>
        <div className="px-1"><FilterPills
          items={SOURCE_FILTERS.map(value => ({ value, label: t(`filters.${value}`), count: counts[value] }))}
          value={filter}
          onChange={setFilter}
          label={t('filterLabel')}
          testId="source-filters"
        /></div>
        <div className="flex items-center gap-1.5 pt-2.5 pr-3 pb-0.5 text-xs text-muted-ink">
          <Checkbox state={pickState(ids, picked)} label={t('selectAllLabel')} onClick={() => setPicked(toggleAll(ids, picked))} />
          <span>{t('selectAll')}</span>
          <span className="flex-1" />
          <span className="tabular-nums" data-testid="organised-summary">{t('organised', summary)}</span>
        </div>
        <div role="listbox" aria-label={t('listLabel')} aria-multiselectable="true" data-workbench-list>
          {visible.length === 0 && <p className="px-2.5 pt-3.5 text-xs font-semibold text-faint">{rows.length ? t('empty') : t('emptyAll')}</p>}
          {visible.map(row => {
            const bucket = dayBucket(row.at, now)
            const heading = bucket !== lastBucket
            lastBucket = bucket
            return (
              <div key={row.id}>
                {heading && <div className="px-2.5 pt-3.5 pb-1.5 text-xs font-semibold text-faint">{t(`days.${bucket}`)}</div>}
                <Row row={row} selected={row.id === selected} picked={picked.has(row.id)} onSelect={() => selectRow(row.id)} onPick={() => setPicked(togglePick(picked, row.id))} />
              </div>
            )
          })}
        </div>
        {picked.size > 0 && (
          <div className="sticky bottom-2 m-1 mt-3 flex items-center gap-2.5 rounded-[10px] bg-invert px-3.5 py-2.5 text-ui-compact text-invert-ink shadow-float" data-testid="source-multi">
            <span className="tabular-nums">{t('picked', { count: picked.size })}</span>
            <span className="flex-1" />
            <button type="button" data-testid="hand-to-commander" className={cn(BTN, 'border-invert-ink bg-invert-ink text-invert hover:bg-invert-ink/90')} onClick={() => void hand()}>{t('handTo', { name: commanderName })}</button>
            <button type="button" className={cn(BTN, 'border-invert-ink/30 bg-transparent text-invert-ink hover:bg-invert-ink/10')} onClick={() => { onDesk(pickedRows); setPicked(new Set()) }}>{t('toDesk')}</button>
            <button type="button" className="cursor-pointer text-invert-ink/70 hover:text-invert-ink" onClick={() => setPicked(new Set())}>{t('clear')}</button>
          </div>
        )}
      </div>
      <div className={cn('flex min-h-0 flex-col', !current && 'max-md:hidden')}>
        {current
          ? <Detail key={current.id} row={current} commanderName={commanderName} onDesk={onDesk} />
          : <p className="px-8 py-6 text-ui-compact text-muted-ink">{t('pickOne')}</p>}
      </div>
    </div>
  )
}
