'use client'

import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'

import { usePluginLocalization } from '@/lib/plugins/localization'
import { useUiV3 } from '@/lib/fork-ui'
import { useEffect } from 'react'
import LocalGraphPanel from '@/app/core/main/graph/local-graph-panel'
import PropertiesPanel from '@/app/core/main/properties/properties-panel'
import BacklinksPanel from '@/app/core/main/backlinks/backlinks-panel'
import { MessageSquare, Link2, SlidersHorizontal, Waypoints } from 'lucide-react'
import { PluginIcon } from './plugin-icon'
import Chat from '@/app/core/main/chat'
import { ChatDock } from '@/app/core/main/threads/chat-dock'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PluginViewSurface } from '@/components/plugins/plugin-view-surface'
import { usePluginUiStore } from '@/lib/plugins/ui-registry'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'
import { useLocale, useTranslations } from 'next-intl'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'

export function PluginRightSidebar() {
  const v3 = useUiV3()
  const chatT = useTranslations('record.chat.v3')
  const builtinTabClass = v3
    ? 'text-xs text-muted-ink hover:bg-hover data-active:border-transparent data-active:bg-active data-active:text-ink dark:data-active:border-transparent dark:data-active:bg-active dark:data-active:text-ink group-data-[variant=default]/tabs-list:data-active:shadow-none'
    : undefined
  const locale = useLocale()
  const t = useTranslations('settings.plugins.ui')
  const backlinksT = useTranslations('backlinks')
  const graphT = useTranslations('localGraph')
  const propertiesT = useTranslations('properties')
  const displaySettings = usePluginStore(state => state.deviceSettings)
  const installed = usePluginStore((state) => state.installed)
  usePluginLocalization(installed, locale)
  const workspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const workspaceStates = usePluginStore((state) => state.workspaceStates)
  const active = usePluginUiStore((state) => state.activeRightView)
  const setActive = usePluginUiStore((state) => state.setActiveRightView)
  const contributions = installed.flatMap((plugin) => {
    const state = workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id] : undefined
    const enabled = isPluginEnabledInWorkspace(plugin, state)
    return enabled ? (plugin.manifest.contributes.views ?? []).filter((view) => view.location === 'right-sidebar' && isPluginDisplayVisible(displaySettings, plugin.manifest.id, view.location)).map((view) => ({ plugin, view, key: `${plugin.manifest.id}:${view.id}` })) : []
  })
  useEffect(() => {
    if (active && active !== '@backlinks' && active !== '@properties' && active !== '@graph' && !contributions.some(item => item.key === active)) setActive(null)
  }, [active, contributions, setActive])
  const selected = contributions.find((item) => item.key === active)
  return (
    <Tabs value={active === '@backlinks' || active === '@properties' || active === '@graph' ? active : selected?.key ?? '@chat'} onValueChange={key => setActive(key === '@chat' ? null : key)} className="h-full min-h-0 min-w-0 gap-0">
      <div className="shrink-0 overflow-x-auto overflow-y-hidden border-b px-2 v3:border-line-soft">
        <TabsList className="my-1 v3:gap-0.5 v3:bg-transparent v3:p-0">
          <TabsTrigger value="@chat" className={builtinTabClass} aria-label={t('chat')}><MessageSquare />{v3 && chatT('tabs.chat')}</TabsTrigger>
          <TabsTrigger value="@backlinks" className={builtinTabClass} aria-label={backlinksT('title')}><Link2 />{v3 && chatT('tabs.links')}</TabsTrigger>
          <TabsTrigger value="@properties" className={builtinTabClass} aria-label={propertiesT('title')}><SlidersHorizontal />{v3 && chatT('tabs.properties')}</TabsTrigger>
          <TabsTrigger value="@graph" className={builtinTabClass} aria-label={graphT('title')}><Waypoints />{v3 && chatT('tabs.graph')}</TabsTrigger>
          {contributions.map(({ plugin, view, key }) => (
            <TabsTrigger key={key} value={key}>
              <PluginIcon name={view.icon} data-icon="inline-start" />
              {resolvePluginViewTitle(plugin, view, locale, workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id]?.settings : undefined)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent forceMount value="@chat" className="min-h-0 overflow-hidden data-[state=inactive]:hidden"><ChatDock><Chat /></ChatDock></TabsContent>
      <TabsContent forceMount value="@backlinks" className="min-h-0 overflow-hidden data-[state=inactive]:hidden"><BacklinksPanel /></TabsContent>
      <TabsContent forceMount value="@properties" className="min-h-0 overflow-hidden data-[state=inactive]:hidden"><PropertiesPanel /></TabsContent>
      <TabsContent forceMount value="@graph" className="min-h-0 overflow-hidden data-[state=inactive]:hidden"><LocalGraphPanel /></TabsContent>
      {selected ? <TabsContent key={selected.key} value={selected.key} className="min-h-0 overflow-hidden"><PluginViewSurface viewKey={selected.key} /></TabsContent> : null}
    </Tabs>
  )
}
