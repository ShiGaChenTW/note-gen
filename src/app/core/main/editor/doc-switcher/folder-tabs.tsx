'use client'

// Fork（almanac ALMNC-97.2）：樣式 B「資料夾標籤」。標題橫排一列、彼此稍微疊在一起，
// 最前面那張和內容接在一起；順序依最近使用（固定的在最左）。
import { Pin, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { DocSwitcherViewProps } from './doc-switcher'
import { tabIcon, tabTitle } from './tab-meta'

export function FolderTabsSwitcher({ tabs, activeTabId, onSwitch, onClose, children }: DocSwitcherViewProps) {
  const t = useTranslations('editor.docSwitcher')

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label={t('label')}
        className="relative z-10 flex h-[34px] shrink-0 items-end overflow-hidden pl-3 pr-2 pt-1"
        data-doc-switcher="folder"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId
          const Icon = tabIcon(tab)
          const title = tabTitle(tab)
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-label={`${title}，${t('position', { index: index + 1, total: tabs.length })}`}
              tabIndex={active ? 0 : -1}
              title={tab.path || title}
              data-tab-id={tab.id}
              onClick={() => { if (!active) onSwitch(tab.id) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSwitch(tab.id)
                }
              }}
              className={cn(
                'group/doc-tab relative -ml-2 flex h-[29px] w-[150px] min-w-0 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-t-[9px] border border-b-0 border-border px-3 text-xs first:ml-0',
                'transition-[transform,background-color,color] duration-200 ease-out',
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
        })}
      </div>
      <div className="relative -mt-px flex min-h-0 min-w-0 flex-1 flex-col border-t border-border bg-card">
        {children}
      </div>
    </div>
  )
}
