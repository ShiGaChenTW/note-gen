'use client'

// Fork（almanac ALMNC-97.2／97.4）：樣式 A「上方疊列」與 C「斜向錯開」。
// 平常只顯示目前這篇（不佔空間）；按標題列的疊卡按鈕才展開：
// - A：後面的卡往上錯開、每張露出 24px 標題列，並往內縮一點。
// - C：後面的卡往左上錯開，標題露在左上角。
// 點後面的卡就切過去，動畫結束後自動收合；Esc、再按一次疊卡按鈕也會收合。
// 後面的卡依最近使用排（第 1 張最靠近前面那張），最多 4 張，其餘收進「更多」。
// 前面那張包著編輯內容，不能有 transform，讓位用 margin；後面的卡只有標題列，可以 transform。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, Layers, Pin, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDocSwitcherStore } from '@/stores/doc-switcher'
import type { TabInfo } from '../tab-bar'
import type { DocSwitcherActions, DocSwitcherViewProps } from './doc-switcher'
import { ensureShown, splitStackTabs } from './recency'
import { tabIcon, tabTitle } from './tab-meta'
import { TabContextMenu } from './tab-context-menu'
import { prefersReducedMotion, SWITCH_MS } from './motion'

/** 每張後面的卡露出的高度／寬度（px）。 */
const STEP_Y = 24
const STEP_X = 28

export function StackSwitcher({ tabs, activeTabId, cycleTargetId, onWheel, children, variant, ...actions }: DocSwitcherViewProps & { variant: 'stack' | 'fan' }) {
  const { onSwitch, onClose } = actions
  const t = useTranslations('editor.docSwitcher')
  const recency = useDocSwitcherStore(state => state.recency)
  const expanded = useDocSwitcherStore(state => state.expanded)
  const setExpanded = useDocSwitcherStore(state => state.setExpanded)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastActive = useRef(activeTabId)
  const collapseTimer = useRef<number | undefined>(undefined)
  const [hovered, setHovered] = useState<string | null>(null)

  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const { back, hidden } = useMemo(() => {
    const rank = new Map(recency.map((id, index) => [id, index]))
    const byRecency = [...tabs].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    const split = splitStackTabs(byRecency, active.id)
    // 按住 ⌃ 選卡時，選到的那張即使在「更多」裡也先換進來標出
    const others = byRecency.filter(tab => tab.id !== active.id)
    const shown = ensureShown(split.back, others, cycleTargetId)
    return { back: shown, hidden: others.filter(tab => !shown.includes(tab)) }
  }, [active.id, cycleTargetId, recency, tabs])

  const open = expanded && back.length > 0
  const depth = open ? back.length : 0
  const offsetY = depth * STEP_Y
  const offsetX = variant === 'fan' ? depth * STEP_X : 0
  const animate = !prefersReducedMotion()
  const transition = animate ? `top ${SWITCH_MS}ms ease, left ${SWITCH_MS}ms ease, transform ${SWITCH_MS}ms ease, opacity ${SWITCH_MS}ms ease` : 'none'

  // Esc 收合
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setExpanded(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, setExpanded])

  // 換篇時內容從側邊淡入（Web Animations，結束不留 transform）
  useLayoutEffect(() => {
    if (lastActive.current === activeTabId) return
    lastActive.current = activeTabId
    if (!animate) return
    contentRef.current?.animate(
      [{ opacity: 0.4, transform: variant === 'fan' ? 'translate(-12px, -12px)' : 'translateY(-12px)' }, { opacity: 1, transform: 'none' }],
      { duration: SWITCH_MS, easing: 'ease-out' },
    )
  }, [activeTabId, animate, variant])

  useEffect(() => () => window.clearTimeout(collapseTimer.current), [])

  const choose = (tabId: string) => {
    onSwitch(tabId)
    window.clearTimeout(collapseTimer.current)
    collapseTimer.current = window.setTimeout(() => setExpanded(false), animate ? SWITCH_MS : 0)
  }

  const ActiveIcon = tabIcon(active)
  const activeTitle = tabTitle(active)

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-doc-switcher={variant} onWheel={(event) => { if ((event.target as HTMLElement).closest('[data-doc-switcher-head]')) onWheel(event) }}>
      {back.map((tab, index) => {
        const d = index + 1
        const lift = hovered === tab.id ? 4 : 0
        const transform = !open
          ? 'none'
          : variant === 'stack'
            ? `translateY(${-STEP_Y * d - lift}px) scaleX(${1 - 0.02 * d})`
            : `translate(${-STEP_X * d - lift}px, ${-STEP_Y * d - lift}px)`
        return (
          <BackCard
            key={tab.id}
            actions={actions}
            tab={tab}
            depth={d}
            total={tabs.length}
            open={open}
            targeted={tab.id === cycleTargetId}
            style={{ top: offsetY, left: offsetX, transform, transition, zIndex: 10 - d }}
            onHover={(on) => setHovered(on ? tab.id : null)}
            onChoose={() => choose(tab.id)}
          />
        )
      })}
      <div
        className={cn('absolute bottom-0 right-0 z-10 flex min-h-0 min-w-0 flex-col overflow-hidden bg-card', open && 'rounded-t-[10px] border border-b-0 border-border shadow-lg')}
        style={{ top: offsetY, left: offsetX, transition }}
      >
        <TabContextMenu tab={active} actions={actions}>
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-3 text-xs text-foreground" data-doc-switcher-head>
          <ActiveIcon className="size-3.5 shrink-0" aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', active.preview && 'italic')} title={active.path || activeTitle}>{activeTitle}</span>
          {open && hidden.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex shrink-0 items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                  {t('more', { count: hidden.length })}
                  <ChevronDown className="size-3" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('moreHeading')}</DropdownMenuLabel>
                {hidden.map(tab => {
                  const Icon = tabIcon(tab)
                  return (
                    <DropdownMenuItem key={tab.id} onSelect={() => choose(tab.id)}>
                      <Icon className="size-3.5" aria-hidden />
                      <span className="truncate">{tabTitle(tab)}</span>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {tabs.length > 1 && (
            <button
              type="button"
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-accent hover:text-foreground',
                open ? 'border-primary text-primary' : 'border-border text-muted-foreground',
              )}
              aria-label={open ? t('collapse') : t('expand')}
              aria-expanded={open}
              onClick={() => setExpanded(!open)}
            >
              <Layers className="size-3" aria-hidden />
              {tabs.length}
            </button>
          )}
          {active.pinned
            ? <Pin className="size-3 shrink-0 text-primary" aria-label={t('pinned')} />
            : (
              <button
                type="button"
                className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('close', { name: activeTitle })}
                onClick={() => onClose(active.id)}
              >
                <X className="size-3" />
              </button>
            )}
        </div>
        </TabContextMenu>
        <div ref={contentRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}

function BackCard({ tab, actions, depth, total, open, targeted, style, onHover, onChoose }: {
  tab: TabInfo
  actions: DocSwitcherActions
  depth: number
  total: number
  open: boolean
  targeted: boolean
  style: CSSProperties
  onHover: (on: boolean) => void
  onChoose: () => void
}) {
  const t = useTranslations('editor.docSwitcher')
  const Icon = tabIcon(tab)
  const title = tabTitle(tab)
  return (
    <TabContextMenu tab={tab} actions={actions}>
    <button
      type="button"
      tabIndex={open ? 0 : -1}
      aria-hidden={!open}
      aria-label={`${title}，${t('position', { index: depth + 1, total })}`}
      title={tab.path || title}
      data-depth={depth}
      data-doc-switcher-head
      data-cycle-target={targeted || undefined}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onChoose}
      className={cn(
        'absolute bottom-0 right-0 flex flex-col overflow-hidden rounded-t-[10px] border border-b-0 border-border bg-muted text-left',
        'hover:border-primary focus-visible:border-primary focus-visible:outline-none',
        'data-[cycle-target=true]:border-primary data-[cycle-target=true]:bg-card data-[cycle-target=true]:ring-1 data-[cycle-target=true]:ring-primary',
        open ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={style}
    >
      <span className="flex h-6 w-full shrink-0 items-center gap-1.5 px-3 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
        {tab.pinned && <Pin className="size-3 shrink-0 text-primary" aria-hidden />}
      </span>
    </button>
    </TabContextMenu>
  )
}
