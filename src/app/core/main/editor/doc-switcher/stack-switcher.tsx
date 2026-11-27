'use client'

// Fork（almanac ALMNC-97.2）：樣式 A「上方疊列」與 C「斜向錯開」。平常只顯示目前這篇（不佔空間），
// 標題列上有疊卡按鈕；展開與選卡在 ALMNC-97.4 實作。
import { Layers, Pin, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { DocSwitcherViewProps } from './doc-switcher'
import { tabIcon, tabTitle } from './tab-meta'

export function StackSwitcher({ tabs, activeTabId, onClose, children, variant }: DocSwitcherViewProps & { variant: 'stack' | 'fan' }) {
  const t = useTranslations('editor.docSwitcher')
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const Icon = tabIcon(active)
  const title = tabTitle(active)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-doc-switcher={variant}>
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-3 text-xs text-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={active.path || title}>{title}</span>
        {tabs.length > 1 && (
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('expand')}
            aria-expanded={false}
            data-doc-switcher-toggle
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
              className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('close', { name: title })}
              onClick={() => onClose(active.id)}
            >
              <X className="size-3" />
            </button>
          )}
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
