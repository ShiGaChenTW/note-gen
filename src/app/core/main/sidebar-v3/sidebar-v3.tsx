'use client'

// Fork（almanac ALMNC-20）：v5 側欄，方案 B「導覽＋檔案樹」。left-sidebar.tsx 在 v3 時直接回傳這個元件。
// ALMNC-79.3 改參考圖風格：由上而下是 56px 品牌列、主要（搜尋＋「＋」選單、五個導覽）、夥伴、我的筆記（全部筆記＋檔案樹）、設定。
// 區與區之間整條分隔線；選中列浮起（SELECTED_RAISED）加左緣墨色指示條；導覽圖示不加方塊底。
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { AlmanacWordmark } from '@/components/almanac-wordmark'
import { LeftSidebarToggleButton } from '@/components/shell-buttons'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ArrowDownToLine, CalendarCheck, CalendarDays, ChevronDown, ChevronRight, ListChecks, Library, MessageSquarePlus, MessagesSquare, MoreHorizontal, Plus, Search, Settings } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Kbd } from '@/components/ui/kbd'
import { Count } from '@/components/v3/count'
import { SectionLabel } from '@/components/v3/section-label'
import { ensureDefaultRoster, listAgentSettings } from '@/db/agents'
import { agentRoleLabel } from '@/lib/agents/display'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { useAnywhereStore } from '@/lib/anywhere/store'
import { usePageVisibility } from '@/lib/fork-overlays/use-page-visibility'
import { useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { useNoteListStore } from '@/lib/note-list/note-list'
import { useSidebarCollapse, type SidebarSection } from '@/lib/sidebar-v3/collapse'
import { buildAgentRows, buildNav, runningAgentCount, type AgentRow, type NavKey } from '@/lib/sidebar-v3/nav'
import type { AgentSettings } from '@/lib/agents/settings'
import { useWeekOverlay } from '@/lib/week/overlay'
import { openAddSource, openNewConversation } from '@/lib/workbench/open'
import { useWorkbenchCount } from '@/lib/workbench/use-workbench'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useDecideStore from '@/stores/decide'
import useHomeStore from '@/stores/home'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useSettingStore from '@/stores/setting'
import useThreadsStore from '@/stores/threads'
import useUpdateStore from '@/stores/update'
import useVaultIndexStore from '@/stores/vault-index'
import { FileSidebar } from '../file'
import { FileActions } from '../file/file-actions'
import { SELECTED_RAISED, SIDEBAR_ROW, SIDEBAR_ROW_ACTIVE } from '../sidebar-row'
import { useVaultName } from './use-vault-name'

const ICONS: Record<NavKey, ComponentType<{ className?: string }>> = {
  today: CalendarCheck,
  decide: ListChecks,
  threads: MessagesSquare,
  knowledge: Library,
  plan: CalendarDays,
}

const OPEN: Record<NavKey, () => void> = {
  today: () => useHomeStore.getState().show(),
  decide: () => useDecideStore.getState().show(),
  threads: () => useThreadsStore.getState().show(),
  knowledge: () => useKnowledgeOverlay.getState().show(),
  plan: () => useWeekOverlay.getState().show(),
}

const ROW = 'flex h-7 w-full items-center gap-2 px-2 text-left text-ui-compact text-muted-ink'
/** 主要導覽的列：比檔案樹鬆（34px），圖示不加方塊底。 */
const NAV_ROW = 'flex h-[34px] w-full items-center gap-2.5 px-2.5 text-left text-ui-compact text-muted-ink'
/** 選中列左緣的墨色指示條：貼齊側欄左緣（區塊左右內距 10px）。 */
const NAV_INDICATOR = "relative before:absolute before:inset-y-2 before:-left-2.5 before:w-[3px] before:rounded-r-(--r-kbd) before:bg-ink before:content-['']"
/** 區段（主要、夥伴、我的筆記）：上下內距一致，區與區之間整條分隔線。 */
const PART = 'shrink-0 border-b border-line px-2.5 py-2.5'
/** 區段標題：可收合的放整列按鈕，動作鈕常駐在右側。 */
const SECTION_TITLE = 'flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-(--r-kbd) px-1.5 text-left outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/60'
const ICON_BUTTON = 'grid size-6 shrink-0 cursor-pointer place-items-center rounded-(--r) text-faint outline-none hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60'

function useAgentRows(): AgentRow[] {
  const [agents, setAgents] = useState<AgentSettings[]>([])
  const tasks = useAgentTaskStore(state => state.tasks)
  const settingsOpen = useSettingsDialogStore(state => state.open)

  // 設定裡新增或改名代理人後（設定視窗關閉）重讀一次；瀏覽器預覽沒有資料庫時維持空清單。
  useEffect(() => {
    if (settingsOpen) return
    // 開發預覽用（不進 production）：瀏覽器沒有 Tauri 資料庫，截圖時從頁面塞 window.__almanacAgentsDemo = AgentSettings[]
    let active = true
    // Fork（almanac ALMNC-54.2）：第一次使用時先建立預設的指揮官、秘書、研究員。
    ensureDefaultRoster().catch(() => false).then(() => listAgentSettings())
      .then(rows => { if (active) setAgents(rows) }).catch(() => undefined)
    return () => { active = false }
  }, [settingsOpen])

  // 開發預覽用（不進 production）：瀏覽器沒有 Tauri 資料庫，截圖時從頁面塞 window.__almanacAgentsDemo = AgentSettings[]
  const demo = process.env.NODE_ENV !== 'production'
    ? (window as unknown as { __almanacAgentsDemo?: AgentSettings[] }).__almanacAgentsDemo : undefined
  return useMemo(() => buildAgentRows(demo ?? agents, tasks), [demo, agents, tasks])
}

function openAgentSettings() {
  useSettingsDialogStore.getState().openSettings('general')
}

/** 區段標題：整列是收合鈕（讀屏名稱「收合／展開＋標題」），動作常駐在右側；收合狀態存在 store.json。 */
function SectionHeader({ section, collapsed, title, aside, actions }: {
  section: SidebarSection
  collapsed: boolean
  title: string
  aside?: ReactNode
  actions?: ReactNode
}) {
  const t = useTranslations('sidebarV3')
  const toggle = useSidebarCollapse(state => state.toggle)
  return (
    <div className="group/section mb-1 flex items-center gap-1 text-muted-ink">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={t(collapsed ? 'expandSection' : 'collapseSection', { title })}
        onClick={() => void toggle(section)}
        className={SECTION_TITLE}
      >
        <ChevronDown className={cn('size-3 shrink-0 text-faint transition-transform duration-100', collapsed && '-rotate-90')} aria-hidden />
        {/* Fork（almanac ALMNC-56.6，V11）：所有區段標題（夥伴、我的筆記）都用 SectionLabel。 */}
        <SectionLabel as="span" className="min-w-0 text-inherit"><span className="block truncate">{title}</span></SectionLabel>
        {aside}
      </button>
      {actions && <div className="flex shrink-0 items-center">{actions}</div>}
    </div>
  )
}

function AgentSection() {
  const t = useTranslations('sidebarV3')
  const tRoles = useTranslations('agents.roles')
  const collapsed = useSidebarCollapse(state => state.agents)
  const rows = useAgentRows()
  const running = runningAgentCount(rows)
  return (
    <section aria-label={t('agents.title')} className={PART}>
      <SectionHeader
        section="agents"
        collapsed={collapsed}
        title={t('agents.title')}
        aside={collapsed && running > 0
          ? <span className="ml-auto font-normal tracking-normal text-muted-ink">{t('agents.running', { count: running })}</span>
          : undefined}
        actions={(
          <button type="button" title={t('agents.add')} aria-label={t('agents.add')} onClick={openAgentSettings} className={ICON_BUTTON}>
            <Plus className="size-3.5" aria-hidden />
          </button>
        )}
      />
      {!collapsed && (
        <ul className="flex flex-col gap-px">
          {rows.map(row => (
            <li key={row.id}>
              <button type="button" onClick={openAgentSettings} className={cn(ROW, SIDEBAR_ROW, 'group/row')}>
                <span aria-hidden className={cn('mx-1 size-1.5 shrink-0 rounded-full bg-faint', row.running && 'bg-ink')} />
                <span className={cn('min-w-0 truncate', !row.enabled && 'opacity-60')}>{row.name}</span>
                <span className="ml-auto shrink-0 text-ui-numeric text-faint group-hover/row:hidden">{agentRoleLabel(row, tRoles)}</span>
                <MoreHorizontal className="ml-auto hidden size-3.5 shrink-0 text-faint group-hover/row:inline-flex" aria-hidden />
              </button>
            </li>
          ))}
          {rows.length === 0 && (
            <li>
              <button type="button" onClick={openAgentSettings} className={cn(ROW, SIDEBAR_ROW)}>
                <Plus className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{t('agents.addFirst')}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function VaultSection() {
  const t = useTranslations('sidebarV3')
  const collapsed = useSidebarCollapse(state => state.vault)
  // Fork（almanac ALMNC-54.17、79.3）：「全部筆記」一列開中間欄，列出整個 vault 的筆記（取代原本點標題開清單）。
  const rootListOpen = useNoteListStore(state => state.visible && state.folder === '')
  // ALMNC-43.12：標題顯示筆記庫資料夾的實際名稱，取不到時用「我的筆記」。
  const vaultName = useVaultName()
  return (
    <section aria-label={vaultName} className={cn('flex min-h-0 flex-col px-2.5 pt-2.5', collapsed ? 'shrink-0 pb-2.5' : 'flex-1')}>
      <SectionHeader
        section="vault"
        collapsed={collapsed}
        title={vaultName}
        actions={<FileActions persistentNew />}
      />
      {!collapsed && (
        <>
          <button
            type="button"
            onClick={() => useNoteListStore.getState().show('')}
            aria-current={rootListOpen ? 'page' : undefined}
            className={cn(ROW, SIDEBAR_ROW, 'mb-1 shrink-0', rootListOpen && SIDEBAR_ROW_ACTIVE)}
          >
            <Library className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('allNotes')}</span>
          </button>
          <div className="-mx-1 min-h-0 flex-1 overflow-hidden [&_#article-sidebar]:bg-transparent">
            <FileSidebar />
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Fork（almanac ALMNC-54.8、54.16、54.18、69.3、79.3）：搜尋右側一顆「＋」，選單裡是新增資料源（N）、新增對話（T）。
 * ALMNC-79.3：原本兩顆只有圖示的方塊看不出意思，收進有文字的選單。
 */
function QuickActions() {
  const t = useTranslations('workbench.quick')
  // Fork（almanac ALMNC-56.4，A02）：單鍵 N／T 只在工作台開著、設定沒關時有效；只在那時標快捷鍵。
  const singleKeys = useSettingStore(state => state.workbenchSingleKeys !== false)
  const workbenchOpen = useDecideStore(state => state.visible)
  const keys = singleKeys && workbenchOpen
  const items: Array<{ key: string, icon: ComponentType<{ className?: string }>, label: string, shortcut?: string, onSelect: () => void }> = [
    { key: 'source', icon: ArrowDownToLine, label: t('addSource'), shortcut: keys ? 'N' : undefined, onSelect: openAddSource },
    { key: 'thread', icon: MessageSquarePlus, label: t('newThread'), shortcut: keys ? 'T' : undefined, onSelect: () => void openNewConversation() },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('label')}
          data-testid="sidebar-quick"
          className="grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-(--r) text-ink outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ink/60 data-[state=open]:bg-active"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {items.map(item => {
          const Icon = item.icon
          return (
            <DropdownMenuItem key={item.key} data-quick={item.key} aria-keyshortcuts={item.shortcut} onSelect={item.onSelect}>
              <Icon className="size-4 text-muted-ink" aria-hidden />
              {item.label}
              {item.shortcut && <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 底部設定入口（ALMNC-79.3：取代原本常駐的「規則」說明；設定鈕從品牌列移下來）。 */
function SettingsRow() {
  const t = useTranslations('sidebarV3')
  const { open, openSettings, closeSettings } = useSettingsDialogStore()
  const hasUpdate = useUpdateStore(state => state.hasUpdate)
  return (
    <div className="mt-auto shrink-0 border-t border-line px-2.5 py-2">
      <button
        type="button"
        onClick={() => open ? closeSettings() : openSettings()}
        aria-pressed={open}
        className={cn(ROW, SIDEBAR_ROW, 'relative', open && SIDEBAR_ROW_ACTIVE)}
      >
        <Settings className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t('settings')}</span>
        {hasUpdate && !open && <span aria-hidden className="size-2 shrink-0 rounded-full bg-danger" />}
      </button>
    </div>
  )
}

export function SidebarV3() {
  const t = useTranslations('sidebarV3')
  const load = useSidebarCollapse(state => state.load)
  // Fork（almanac ALMNC-54.14）：和今天頁「工作台 · N 件」同一個數字。
  const decideCount = useWorkbenchCount()
  const visibility = usePageVisibility()
  const nav = buildNav({ decideCount, visibility })

  useEffect(() => { void load() }, [load])
  // 開發預覽用（不進 production）：截圖時從頁面塞示範檔案樹，window.__almanacSidebar.article.setState({ fileTree })；資料夾筆記數用 vaultIndex.replaceAll
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') (window as unknown as Record<string, unknown>).__almanacSidebar = { article: useArticleStore, setting: useSettingStore, vaultIndex: useVaultIndexStore }
  }, [])

  return (
    <div className="flex h-full w-full flex-col border-r border-line bg-panel" data-left-sidebar data-sidebar-v3>
      {/* Fork（almanac ALMNC-62、79.3）：56px 品牌列，和主區頁首同高、底線切齊；設定移到最下方。 */}
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line pr-2 pl-4" data-sidebar-brand>
        <AlmanacWordmark className="h-[15px] text-ink" />
        <span className="flex-1" />
        <TooltipProvider>
          <LeftSidebarToggleButton />
        </TooltipProvider>
      </div>
      <div className={PART}>
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => useAnywhereStore.getState().setPaletteOpen(true)}
            className="flex h-[30px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-(--r) border border-line bg-bg pr-1.5 pl-2 text-left text-ui-compact text-muted-ink outline-none hover:border-ink/30 focus-visible:ring-1 focus-visible:ring-ink/60"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{t('search')}</span>
            <Kbd>⌘K</Kbd>
          </button>
          <QuickActions />
        </div>
        <SectionLabel className="mb-1 h-6 px-1.5 font-medium text-faint">{t('mainSection')}</SectionLabel>
        <nav aria-label={t('navLabel')} className="flex flex-col gap-px">
          {nav.map(row => {
            const Icon = ICONS[row.key]
            return (
              <button
                key={row.key}
                type="button"
                onClick={OPEN[row.key]}
                aria-current={row.active ? 'page' : undefined}
                className={cn(NAV_ROW, SIDEBAR_ROW, row.active && [SIDEBAR_ROW_ACTIVE, SELECTED_RAISED, NAV_INDICATOR])}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t(`nav.${row.key}`)}</span>
                <Count value={row.count} max={99} emphasis={row.key === 'decide'} label={t('count', { count: row.count })} />
                {row.active && !row.count && <ChevronRight className="size-3.5 shrink-0 text-muted-ink" aria-hidden />}
              </button>
            )
          })}
        </nav>
      </div>
      <AgentSection />
      <VaultSection />
      <SettingsRow />
    </div>
  )
}
