'use client'

// Fork（almanac ALMNC-10 → ALMNC-54.8）：V3 工作台（原「等你定」頁）。介面以 almanac/2026-11-20_proposal_v3-workbench_v14.html 為準：
// 兩個分頁——審核（夥伴的提案，一條清單＋標籤篩選＋就地決定）與資料源（原收集箱，Q36）；檯面是獨立的專注模式。
// 清單都是從來源現況投影（lib/workbench），這一頁不存待決狀態；先放著、復原堆疊、勾選等畫面狀態在 stores/workbench。
// 鍵盤（v14）：審核 ↑↓／J K 選擇、↵ 展開、A 主要動作、D 再次討論、X 放棄、C 完成、T 攤到檯面、S 先放著、Z 復原；
// 資料源 J K 選擇、空白鍵勾選、E 編輯、A 照建議處理、X 不採用、Z 復原；編輯器 ⌘S 存、Esc 取消；檯面 Esc 回工作台。
// 單鍵（V3、工作台開著、沒在打字；設定可關，ALMNC-56.4）：N 新增資料源、T 新增對話。只在新介面（v3）出現。
import { useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { V3_BUTTON_SHAPE } from '@/components/v3/button-shape'
import { Count } from '@/components/v3/count'
import { Segmented } from '@/components/v3/segmented'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { useUiV3 } from '@/lib/fork-ui'
import { refreshJournal } from '@/lib/decide/actions'
import { useJournalPolling } from '@/lib/decide/journal-refresh'
import { isEditableKeyboardTarget } from '@/lib/is-editable-keyboard-target'
import { actionForKey } from '@/lib/workbench/cards'
import { globalShortcutFor, keyBelongsToTarget } from '@/lib/workbench/keyboard-target'
import { refreshSources } from '@/lib/workbench/actions'
import { openAddSource, openNewConversation, openWorkbench } from '@/lib/workbench/open'
import { filterRows, togglePick, waitingCount, type SourceListRow } from '@/lib/workbench/sources-tab'
import { useCommanderName, useReviewData, useSourceRows, type ReviewData } from '@/lib/workbench/use-workbench'
import { cn } from '@/lib/utils'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import useInboxStore from '@/stores/inbox'
import useProposalTrailStore from '@/stores/proposals'
import useSettingStore from '@/stores/setting'
import useWorkbenchStore, { type WorkbenchTab } from '@/stores/workbench'
import { SyncConflictCards } from '@/components/sync/sync-conflict-card'
import { PageHeader, PageSurface } from '../page-ui'
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

/**
 * Fork（almanac ALMNC-56.4，A04）：j／k 移動後把焦點放到那一項（卡片收合列、資料源那列的按鈕），讀屏才會念出目前那一項；
 * 捲到看得見的位置。
 */
function focusItem(selector: string) {
  const item = document.querySelector<HTMLElement>(selector)
  item?.querySelector<HTMLElement>('[data-workbench-item]')?.focus({ preventScroll: true })
  item?.scrollIntoView?.({ block: 'nearest' })
}

/** Fork（almanac ALMNC-56.6，V05）：審核｜資料源頁籤改用共用的 Segmented＋Count（和收集、知識頁同一套）。 */
function Tabs({ review, sources }: { review: number, sources: number }) {
  const t = useTranslations('workbench.tabs')
  const tab = useWorkbenchStore(state => state.tab)
  const setTab = useWorkbenchStore(state => state.setTab)
  const items: Array<{ value: WorkbenchTab, count: number }> = [{ value: 'review', count: review }, { value: 'sources', count: sources }]
  return (
    <div data-testid="workbench-tabs">
      <Segmented
        kind="tabs"
        className="[&>button]:text-ui-compact"
        label={t('label')}
        value={tab}
        onChange={setTab}
        items={items.map(item => ({ value: item.value, label: <>{t(item.value)}<Count value={item.count} /></> }))}
      />
    </div>
  )
}

/**
 * 審核與資料源分頁的單鍵操作（capture 階段先處理，攤到檯面的 T 不會被全域「新增對話」搶走）。
 * Fork（almanac ALMNC-56.1）：焦點在按鈕、連結、頁籤或選單上時，Enter、空白鍵、方向鍵讓給那個元件（見 keyBelongsToTarget）。
 */
function useWorkbenchKeys(data: ReviewData, rows: SourceListRow[], actions: ReturnType<typeof useCardActions>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!plainKey(event) || isEditableKeyboardTarget(event.target) || keyBelongsToTarget(event.target, event.key) || anyDialogOpen()) return
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
          focusItem(`[data-card="${CSS.escape(next.key)}"]`)
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
        if (/^[1-9]$/.test(key) && current.choices?.[Number(key) - 1]) { event.preventDefault(); void actions.run(current, 'pick', { note: current.choices[Number(key) - 1] }); return }
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
        focusItem(`[data-row="${CSS.escape(next.id)}"]`)
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
          {/* Fork（almanac ALMNC-56.6，V05）：共用的 PageHeader——標題看得見、高度和其他 V3 頁一致；動作用 Button。 */}
          <div className="contents" data-testid="workbench-header">
            <PageHeader
              title={t('title')}
              onBack={hide}
              tabs={<Tabs review={data.visible.length} sources={waitingCount(rows)} />}
              actions={tab === 'review' && (
                <Button
                  variant="ghost"
                  aria-label={t('putAside.entry')}
                  aria-pressed={showAside}
                  data-testid="aside-entry"
                  onClick={() => setShowAside(!showAside)}
                  className={cn(V3_BUTTON_SHAPE, 'gap-2 text-ui-compact font-normal text-muted-ink hover:bg-hover hover:text-ink', showAside && 'bg-active text-ink')}
                >
                  <Clock className="size-4" aria-hidden />
                  <span>{t('putAside.count', { count: data.aside.length })}</span>
                </Button>
              )}
            />
          </div>
          {/* Fork（almanac ALMNC-85.3，第 8 節 3A）：V3 同步的確認卡（Scott 的偏好、soul、rules 兩台改到同一段），沒有就不佔位置。 */}
          <SyncConflictCards />
          {tab === 'review'
            ? <ReviewTab data={data} actions={actions} commanderName={commanderName} />
            : <SourcesTab rows={rows} commanderName={commanderName} onDesk={onDesk} />}
        </>
      )}
    </PageSurface>
  )
}

/**
 * 單鍵：N 新增資料源、T 新增對話（v14）。打字中、有對話框、檯面上都不攔。
 * Fork（almanac ALMNC-56.4，A02）：只在工作台畫面開著時生效，設定裡可以關掉；焦點在選單上時字母留給選單跳項目。
 */
function useGlobalShortcuts(isV3: boolean, workbenchOpen: boolean) {
  const enabled = useSettingStore(state => state.workbenchSingleKeys !== false)
  useEffect(() => {
    if (!isV3 || !enabled || !workbenchOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (!plainKey(event) || event.shiftKey || event.repeat || isEditableKeyboardTarget(event.target) || keyBelongsToTarget(event.target, event.key) || anyDialogOpen()) return
      const shortcut = globalShortcutFor(event.key, { enabled, workbenchOpen: useDecideStore.getState().visible, deskOpen: useWorkbenchStore.getState().desk.open })
      if (!shortcut) return
      event.preventDefault()
      if (shortcut === 'addSource') openAddSource()
      else void openNewConversation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isV3, enabled, workbenchOpen])
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

  useGlobalShortcuts(isV3, visible)
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
  // Fork（almanac ALMNC-56.7，P06）：只在工作台開著、視窗沒隱藏時每分鐘讀一次日誌。
  useJournalPolling(isV3 && visible, refreshJournal)
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
