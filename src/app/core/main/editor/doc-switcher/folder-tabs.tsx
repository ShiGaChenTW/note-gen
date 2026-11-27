'use client'

// Fork（almanac ALMNC-97.2／97.3）：樣式 B「資料夾標籤」。標題橫排一列、彼此稍微疊在一起，
// 最前面那張和內容接在一起；順序依最近使用（固定的在最左）。
// 切換時，選到的那張浮起來、滑到第一個位置再落下，其他標籤滑動讓位（FLIP）；內容從左邊淡入。
// 放不下的標籤（最久沒看的）收進「更多」。系統開啟「減少動態效果」時不做動畫。
import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Pin, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TabInfo } from '../tab-bar'
import type { DocSwitcherViewProps } from './doc-switcher'
import { ensureShown, folderTabCapacity, splitVisibleTabs } from './recency'
import { tabIcon, tabTitle } from './tab-meta'
import { prefersReducedMotion, SWITCH_MS } from './motion'

const LIFT = 'translateY(-6px) scale(1.04)'

export function FolderTabsSwitcher({ tabs, activeTabId, cycleTargetId, onWheel, onSwitch, onClose, children }: DocSwitcherViewProps) {
  const t = useTranslations('editor.docSwitcher')
  const rowRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  const lastLeft = useRef(new Map<string, number>())
  const lastActive = useRef(activeTabId)
  const [rowWidth, setRowWidth] = useState(0)

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    setRowWidth(row.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setRowWidth(row.clientWidth))
    observer.observe(row)
    return () => observer.disconnect()
  }, [])

  // 量整列（含「更多」按鈕的位置）的寬度；還沒量到（第一次渲染）時先全部顯示，量到後再收。
  const capacity = rowWidth > 0 ? folderTabCapacity(rowWidth, tabs.length) : tabs.length
  const split = splitVisibleTabs(tabs, activeTabId, capacity)
  // 按住 ⌃ 選卡時，選到的那張即使在「更多」裡也先換進來標出
  const visible = ensureShown(split.visible, tabs, cycleTargetId, activeTabId)
  const hidden = tabs.filter(tab => !visible.includes(tab))
  const order = visible.map(tab => tab.id).join('\n')

  // FLIP：記下每張標籤上一次的位置，順序變了就從舊位置滑到新位置。
  useLayoutEffect(() => {
    const switched = lastActive.current !== activeTabId
    lastActive.current = activeTabId
    const animate = !prefersReducedMotion()
    const timers: number[] = []
    for (const [id, el] of tabRefs.current) {
      const left = el.offsetLeft
      const before = lastLeft.current.get(id)
      lastLeft.current.set(id, left)
      if (!animate) continue
      const lifted = switched && id === activeTabId
      const dx = before === undefined ? 0 : before - left
      if (dx === 0 && !lifted) continue
      el.style.transition = 'none'
      el.style.transform = `translateX(${dx}px)${lifted ? ` ${LIFT}` : ''}`
      void el.offsetWidth
      el.style.transition = ''
      el.style.transform = lifted ? LIFT : ''
      if (lifted) {
        el.dataset.lifted = 'true'
        timers.push(window.setTimeout(() => {
          el.style.transform = ''
          delete el.dataset.lifted
        }, SWITCH_MS))
      }
    }
    for (const id of [...lastLeft.current.keys()]) if (!tabRefs.current.has(id)) lastLeft.current.delete(id)
    // 內容從左邊淡入；用 Web Animations，結束後不會在容器上留下 transform（TipTap 浮動選單靠它定位）。
    if (switched && animate) {
      contentRef.current?.animate(
        [{ opacity: 0.4, transform: 'translateX(-16px)' }, { opacity: 1, transform: 'none' }],
        { duration: SWITCH_MS, easing: 'ease-out' },
      )
    }
    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [activeTabId, order])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={rowRef} className="relative z-10 flex h-[34px] shrink-0 items-end pr-2" data-doc-switcher-row onWheel={onWheel}>
        <div
          role="tablist"
          aria-label={t('label')}
          className="flex min-w-0 flex-1 items-end pl-3 pt-1"
          data-doc-switcher="folder"
        >
          {visible.map((tab, index) => (
            <FolderTab
              key={tab.id}
              tab={tab}
              index={index}
              total={tabs.length}
              active={tab.id === activeTabId}
              targeted={tab.id === cycleTargetId}
              register={(el) => { if (el) tabRefs.current.set(tab.id, el); else tabRefs.current.delete(tab.id) }}
              onSwitch={onSwitch}
              onClose={onClose}
            />
          ))}
        </div>
        {hidden.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mb-1 flex shrink-0 items-center gap-0.5 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t('more', { count: hidden.length })}
                <ChevronDown className="size-3" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('moreHeading')}</DropdownMenuLabel>
              {hidden.map(tab => {
                const Icon = tabIcon(tab)
                return (
                  <DropdownMenuItem key={tab.id} onSelect={() => onSwitch(tab.id)}>
                    <Icon className="size-3.5" aria-hidden />
                    <span className="truncate">{tabTitle(tab)}</span>
                    {tab.pinned && <Pin className="ml-auto size-3 text-primary" aria-label={t('pinned')} />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div ref={contentRef} className="relative -mt-px flex min-h-0 min-w-0 flex-1 flex-col border-t border-border bg-card">
        {children}
      </div>
    </div>
  )
}

function FolderTab({ tab, index, total, active, targeted, register, onSwitch, onClose }: {
  tab: TabInfo
  index: number
  total: number
  active: boolean
  targeted: boolean
  register: (el: HTMLDivElement | null) => void
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
}) {
  const t = useTranslations('editor.docSwitcher')
  const Icon = tabIcon(tab)
  const title = tabTitle(tab)
  return (
    <div
      ref={register}
      role="tab"
      aria-selected={active}
      aria-label={`${title}，${t('position', { index: index + 1, total })}`}
      tabIndex={active ? 0 : -1}
      title={tab.path || title}
      data-cycle-target={targeted || undefined}
      onClick={() => { if (!active) onSwitch(tab.id) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSwitch(tab.id)
        }
      }}
      className={cn(
        'relative -ml-2 flex h-[29px] w-[150px] min-w-0 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-t-[9px] border border-b-0 border-border px-3 text-xs first:ml-0',
        'transition-[transform,translate,background-color,color,box-shadow] duration-300 ease-out motion-reduce:transition-none',
        'data-[lifted=true]:z-30 data-[lifted=true]:rounded-[9px] data-[lifted=true]:border-b data-[lifted=true]:shadow-lg',
        'data-[cycle-target=true]:z-30 data-[cycle-target=true]:border-primary data-[cycle-target=true]:text-foreground data-[cycle-target=true]:ring-1 data-[cycle-target=true]:ring-primary',
        active
          ? 'z-20 h-[30px] bg-card text-foreground'
          : 'translate-y-[3px] bg-muted text-muted-foreground hover:text-foreground',
      )}
      style={active ? undefined : { zIndex: Math.max(1, 15 - index) }}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className={cn('min-w-0 flex-1 truncate', tab.preview && 'italic')}>{title}</span>
      {tab.pinned
        ? <Pin className="size-3 shrink-0 text-primary" aria-label={t('pinned')} />
        : active && (
          <button
            type="button"
            className="-mr-1 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('close', { name: title })}
            onClick={(event) => { event.stopPropagation(); onClose(tab.id) }}
          >
            <X className="size-3" />
          </button>
        )}
    </div>
  )
}
