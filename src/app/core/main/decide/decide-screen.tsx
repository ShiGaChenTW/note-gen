'use client'

// Fork（almanac ALMNC-10 → ALMNC-54.8）：V3 工作台（原「等你定」頁）。介面以 almanac/2026-11-20_proposal_v3-workbench_v14.html 為準：
// 兩個分頁——審核（夥伴的提案，一條清單＋標籤篩選＋就地決定）與資料源（原收集箱，Q36）；檯面是獨立的專注模式。
// 清單都是從來源現況投影（lib/workbench），這一頁不存待決狀態；先放著、復原堆疊、勾選等畫面狀態在 stores/workbench。
// 鍵盤（v14）：審核 ↑↓／J K 選擇、↵ 展開、A 主要動作、D 再次討論、X 放棄、C 完成、T 攤到檯面、S 先放著、Z 復原；
// 資料源 J K 選擇、空白鍵勾選、E 編輯、A 照建議處理、X 不採用、Z 復原；編輯器 ⌘S 存、Esc 取消；檯面 Esc 回工作台。
// 全域（V3、沒在打字）：N 新增資料源、T 新增對話。只在新介面（v3）出現。
import { useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Clock } from 'lucide-react'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { useUiV3 } from '@/lib/fork-ui'
import { refreshJournal } from '@/lib/decide/actions'
import { isEditableKeyboardTarget } from '@/lib/is-editable-keyboard-target'
import { actionForKey } from '@/lib/workbench/cards'
import { refreshSources } from '@/lib/workbench/actions'
import { openAddSource, openNewConversation, openWorkbench } from '@/lib/workbench/open'
import { filterRows, togglePick, waitingCount, type SourceListRow } from '@/lib/workbench/sources-tab'
import { useCommanderName, useReviewData, useSourceRows, type ReviewData } from '@/lib/workbench/use-workbench'
import { cn } from '@/lib/utils'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import useInboxStore from '@/stores/inbox'
import useProposalTrailStore from '@/stores/proposals'
import useWorkbenchStore, { type WorkbenchTab } from '@/stores/workbench'
import { PageSurface } from '../page-ui'
import { Desk } from './desk'
import { currentOf, ReviewTab } from './review-tab'
import { materialOf, SourcesTab } from './sources-tab'
import { useCardActions } from './use-card-actions'

function anyDialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]'))
}

function plainKey(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && !event.defaultPrevented
}

function Tabs({ review, sources }: { review: number, sources: number }) {
  const t = useTranslations('workbench.tabs')
  const tab = useWorkbenchStore(state => state.tab)
  const setTab = useWorkbenchStore(state => state.setTab)
  const items: Array<{ value: WorkbenchTab, count: number }> = [{ value: 'review', count: review }, { value: 'sources', count: sources }]
  return (
    <div role="tablist" aria-label={t('label')} className="flex h-full gap-[22px]" data-testid="workbench-tabs">
      {items.map(item => {
        const selected = tab === item.value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-tab={item.value}
            onClick={() => setTab(item.value)}
            className={cn(
              'relative flex h-full cursor-pointer items-center gap-[7px] text-sm font-semibold text-muted-ink outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60',
              'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-sm after:bg-transparent',
              selected && 'text-ink after:bg-ink',
            )}
          >
            {t(item.value)}
            <span className="rounded-full bg-hover px-1.5 text-xs leading-[18px] font-medium tabular-nums">{item.count}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 審核與資料源分頁的單鍵操作（capture 階段先處理，攤到檯面的 T 不會被全域「新增對話」搶走）。 */
function useWorkbenchKeys(data: ReviewData, rows: SourceListRow[], actions: ReturnType<typeof useCardActions>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!plainKey(event) || isEditableKeyboardTarget(event.target) || anyDialogOpen()) return
      const store = useWorkbenchStore.getState()
      if (store.desk.open || store.editing) return
      const key = event.key.toLowerCase()
      if (store.tab === 'review') {
        if (store.showAside) return
        const { visible, current } = currentOf(data, store.filter, store.cursor)
        const move = (delta: number) => {
          if (!visible.length) return
          const index = Math.max(0, Math.min(visible.length - 1, visible.findIndex(card => card.key === current?.key) + delta))
          const next = visible[index]!
          store.setCursor(next.key)
          if (store.expanded) store.setExpanded(next.key)
          document.querySelector(`[data-card="${CSS.escape(next.key)}"]`)?.scrollIntoView?.({ block: 'nearest' })
        }
        if (key === 'arrowdown' || key === 'j') { event.preventDefault(); move(1); return }
        if (key === 'arrowup' || key === 'k') { event.preventDefault(); move(-1); return }
        if (key === 'z') { event.preventDefault(); void actions.undo(); return }
        if (!current) return
        if (key === 'enter' || key === ' ') {
          event.preventDefault()
          store.setCursor(current.key)
          store.setExpanded(store.expanded === current.key ? null : current.key)
          return
        }
        if (key === 's') { event.preventDefault(); actions.putAside(current); return }
        if (/^[1-9]$/.test(key) && current.choices?.[Number(key) - 1]) { event.preventDefault(); void actions.run(current, 'pick'); return }
        const action = actionForKey(current, key)
        if (!action) return
        event.preventDefault()
        // 需要再填東西的動作（再次討論的說明、排時間的時間）：展開卡片、按那個按鈕。
        if (action === 'discuss' || action === 'schedule') {
          store.setExpanded(current.key)
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-card="${CSS.escape(current.key)}"] [data-action="${action}"]`)?.click())
          return
        }
        void actions.run(current, action)
        return
      }
      // 資料源分頁
      const list = filterRows(rows, store.sourceFilter)
      const index = list.findIndex(row => row.id === store.selectedRow)
      const current = list[index]
      if (key === 'arrowdown' || key === 'j' || key === 'arrowup' || key === 'k') {
        event.preventDefault()
        if (!list.length) return
        const delta = key === 'arrowdown' || key === 'j' ? 1 : -1
        const next = list[Math.max(0, Math.min(list.length - 1, index < 0 ? 0 : index + delta))]!
        store.selectRow(next.id)
        document.querySelector(`[data-row="${CSS.escape(next.id)}"]`)?.scrollIntoView?.({ block: 'nearest' })
        return
      }
      if (key === 'z') { event.preventDefault(); void actions.undo(); return }
      if (!current) return
      if (key === ' ') { event.preventDefault(); store.setPicked(togglePick(store.picked, current.id)); return }
      const button = key === 'e' ? 'edit' : key === 'a' ? 'process' : key === 'x' ? 'reject' : key === 'r' ? 'retry' : null
      if (!button) return
      const target = document.querySelector<HTMLButtonElement>(`[data-testid="source-detail"] [data-source-action="${button}"]`)
      if (!target) return
      event.preventDefault()
      target.click()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [actions, data, rows])
}

function WorkbenchPage() {
  const t = useTranslations('workbench')
  const hide = useDecideStore(state => state.hide)
  const tab = useWorkbenchStore(state => state.tab)
  const deskOpen = useWorkbenchStore(state => state.desk.open)
  const showAside = useWorkbenchStore(state => state.showAside)
  const setShowAside = useWorkbenchStore(state => state.setShowAside)
  const data = useReviewData()
  const rows = useSourceRows()
  const commanderName = useCommanderName()
  const filter = useWorkbenchStore(state => state.filter)
  const visible = useMemo(() => currentOf(data, filter, null).visible, [data, filter])
  const actions = useCardActions({ visible, commanderName })
  useWorkbenchKeys(data, rows, actions)

  useEffect(() => {
    void refreshSources()
    void useInboxStore.getState().refresh()
    const timer = setInterval(() => void refreshSources(), 15_000)
    return () => clearInterval(timer)
  }, [])

  /** Esc：檯面 → 編輯器 → 展開的卡片 → 先放著清單 → 收起整頁。 */
  function dismiss() {
    const store = useWorkbenchStore.getState()
    if (store.desk.open) return store.closeDesk()
    if (store.editing) return void document.querySelector<HTMLButtonElement>('[data-testid="source-editor"] button')?.click()
    if (store.expanded) return store.setExpanded(null)
    if (store.showAside) return store.setShowAside(false)
    hide()
  }

  function onDesk(list: SourceListRow[]) {
    if (!list.length) return
    useWorkbenchStore.getState().openDesk(list.map(materialOf))
  }

  return (
    <PageSurface label={t('title')} onDismiss={dismiss}>
      {deskOpen ? <Desk commanderName={commanderName} /> : (
        <>
          <header className="flex h-[52px] shrink-0 items-center border-b border-line-soft pr-6 pl-7" data-testid="workbench-header">
            <h1 className="sr-only">{t('title')}</h1>
            <Tabs review={data.visible.length} sources={waitingCount(rows)} />
            <div className="ml-auto flex items-center gap-1.5">
              {tab === 'review' && (
                <button
                  type="button"
                  aria-label={t('putAside.entry')}
                  aria-pressed={showAside}
                  data-testid="aside-entry"
                  onClick={() => setShowAside(!showAside)}
                  className={cn('flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2.5 text-ui-compact text-muted-ink outline-none hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60', showAside && 'bg-active text-ink')}
                >
                  <Clock className="size-4" aria-hidden />
                  <span>{t('putAside.count', { count: data.aside.length })}</span>
                </button>
              )}
            </div>
          </header>
          {tab === 'review'
            ? <ReviewTab data={data} actions={actions} commanderName={commanderName} />
            : <SourcesTab rows={rows} commanderName={commanderName} onDesk={onDesk} />}
        </>
      )}
    </PageSurface>
  )
}

/** 全域單鍵：N 新增資料源、T 新增對話（v14）。打字中、有對話框、檯面上都不攔。 */
function useGlobalShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      if (!plainKey(event) || event.shiftKey || event.repeat || isEditableKeyboardTarget(event.target) || anyDialogOpen()) return
      if (useWorkbenchStore.getState().desk.open && useDecideStore.getState().visible) return
      const key = event.key.toLowerCase()
      if (key === 'n') { event.preventDefault(); openAddSource() }
      else if (key === 't') { event.preventDefault(); void openNewConversation() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/** 一直掛著：讀回保存的收集提案、先放著、今日日誌；舊的收集／Inbox 入口在新介面一律轉到工作台的資料源分頁。 */
export function DecideScreen() {
  const isV3 = useUiV3()
  const visible = useDecideStore(state => state.visible)
  const hydrate = useCollectStore(state => state.hydrate)
  const hydrateTrail = useProposalTrailStore(state => state.hydrate)
  const hydrateAside = useWorkbenchStore(state => state.hydrateAside)
  const items = useCollectStore(state => state.items)
  const waiting = useMemo(() => items.reduce((n, item) => n + item.proposals.filter(p => p.status === 'wait').length, 0), [items])

  useGlobalShortcuts(isV3)
  useEffect(() => {
    if (!isV3) return
    void hydrate()
    void hydrateTrail()
    void hydrateAside()
    void refreshSources()
  }, [isV3, hydrate, hydrateTrail, hydrateAside])
  useEffect(() => {
    if (isV3) void refreshJournal()
  }, [isV3, visible, waiting])
  useEffect(() => {
    if (!isV3) return
    const timer = setInterval(() => void refreshJournal(), 60_000)
    return () => clearInterval(timer)
  }, [isV3])
  // Fork（almanac ALMNC-54.8）：主選單沒有「收集」了；舊入口（命令面板、記錄存好的「查看」…）打開收集或 Inbox 時改開資料源分頁。
  useEffect(() => {
    if (!isV3) return
    const toSources = (rowId?: string) => queueMicrotask(() => openWorkbench('sources', rowId))
    const offCollect = useCollectStore.subscribe((state, previous) => {
      if (!state.visible || previous.visible) return
      useCollectStore.getState().hide()
      toSources()
    })
    const offInbox = useInboxStore.subscribe((state, previous) => {
      if (!state.visible || previous.visible) return
      const focus = state.focusedMarkId
      useInboxStore.getState().hide()
      toSources(focus !== null ? `rec:${focus}` : undefined)
    })
    if (useCollectStore.getState().visible) { useCollectStore.getState().hide(); toSources() }
    if (useInboxStore.getState().visible) { useInboxStore.getState().hide(); toSources() }
    return () => { offCollect(); offInbox() }
  }, [isV3])
  // 開發預覽用：瀏覽器沒有 Tauri，截圖時要從頁面塞示範資料進 store。
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    ;(window as unknown as Record<string, unknown>).__almanac = { collect: useCollectStore, decide: useDecideStore, tasks: useAgentTaskStore, workbench: useWorkbenchStore, inbox: useInboxStore }
  }, [])

  return isV3 && visible ? <WorkbenchPage /> : null
}
