'use client'

import { useEffect, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { openDeveloperTools, supportsNativeDeveloperTools } from '@/lib/developer-tools'
import useSettingStore from '@/stores/setting'
import { ConfigFileActions } from './config-file-actions'
import { Code2, Gauge, MonitorCog, Network } from 'lucide-react'
import { SettingSection } from '../components/setting-base'
import { DeveloperDiagnostics } from './developer-diagnostics'
import { SystemPermissions } from './system-permissions'
import { AppLockSettings } from './app-lock-settings'

export function AdvancedSettings({ showConfigFileActions = true }: { showConfigFileActions?: boolean }) {
  const t = useTranslations('settings.dev')
  const [proxy, setProxy] = useState('')
  const [systemProxy, setSystemProxy] = useState(false)
  const [proxyLoaded, setProxyLoaded] = useState(false)
  const proxySaveQueue = useRef<Promise<void>>(Promise.resolve())
  const developerMode = useSettingStore(state => state.developerMode)
  const setDeveloperMode = useSettingStore(state => state.setDeveloperMode)
  const developerPerformanceInfo = useSettingStore(state => state.developerPerformanceInfo)
  const setDeveloperPerformanceInfo = useSettingStore(state => state.setDeveloperPerformanceInfo)
  const desktop = supportsNativeDeveloperTools()
  const { toast } = useToast()

  async function handleOpenDeveloperTools() {
    try {
      await openDeveloperTools()
    } catch (error) {
      toast({
        title: t('openDeveloperToolsFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  function saveProxy(address: string, useSystem: boolean) {
    // Serialize blur and switch events so an older save cannot restore a manual
    // address after system proxy has been enabled.
    proxySaveQueue.current = proxySaveQueue.current.then(async () => {
      const store = await Store.load('store.json')
      await store.set('proxyCustomURL', address.trim())
      // Existing sync/image/skill clients use an empty proxy to let reqwest
      // discover the system configuration when creating their next client.
      await store.set('proxy', useSystem ? '' : address.trim())
      await store.set('systemProxy', useSystem)
      await store.save()
    }).catch(() => {
      toast({ title: t('proxySaveFailed'), variant: 'destructive' })
    })
  }

  useEffect(() => {
    async function loadProxy() {
      const store = await Store.load('store.json')
      const storedProxy = await store.get<string>('proxy')
      const useSystem = (await store.get<boolean>('systemProxy')) === true
      const customProxy = useSystem ? await store.get<string>('proxyCustomURL') : storedProxy
      setProxy(customProxy || '')
      setSystemProxy(useSystem)
      setProxyLoaded(true)
    }

    void loadProxy().catch(() => {
      toast({ title: t('proxyLoadFailed'), variant: 'destructive' })
    })
  }, [t, toast])

  return (
    <>
      <SettingSection title={t('title')} desc={t('desc')}>
        <ItemGroup className="gap-3">
          {desktop || systemProxy ? (
            <Item variant="outline">
              <ItemMedia variant="icon"><Network /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('systemProxyTitle')}</ItemTitle>
                <ItemDescription className="line-clamp-none">{t('systemProxyDesc')}</ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto">
                <Switch
                  checked={systemProxy}
                  disabled={!proxyLoaded}
                  onCheckedChange={(checked) => {
                    setSystemProxy(checked)
                    saveProxy(proxy, checked)
                  }}
                  aria-label={t('systemProxyTitle')}
                />
              </ItemActions>
            </Item>
          ) : null}
          <Item variant="outline">
            <ItemMedia variant="icon"><Network /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('proxyTitle')}</ItemTitle>
              <ItemDescription>{t('proxy')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
              <Input
                className="w-full sm:w-[280px]"
                placeholder={t('proxyPlaceholder')}
                aria-label={t('proxyTitle')}
                disabled={!proxyLoaded || systemProxy}
                value={proxy}
                onChange={(event) => setProxy(event.target.value)}
                onBlur={() => saveProxy(proxy, systemProxy)}
              />
            </ItemActions>
          </Item>
          {showConfigFileActions ? <ConfigFileActions /> : null}
        </ItemGroup>
      </SettingSection>

      <SystemPermissions />
      <AppLockSettings />

      <SettingSection title={t('developerTitle')} desc={t('developerDesc')}>
        <ItemGroup className="gap-3">
          <Item variant="warning">
            <ItemMedia variant="icon"><Code2 /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('developerModeTitle')}</ItemTitle>
              <ItemDescription>{t('developerModeDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto">
              <Switch
                checked={developerMode}
                onCheckedChange={setDeveloperMode}
                aria-label={t('developerModeTitle')}
              />
            </ItemActions>
          </Item>

          {developerMode ? (
            <div className="flex flex-col gap-2">
              {desktop ? (
                <Item variant="outline" size="sm">
                  <ItemMedia variant="icon"><MonitorCog /></ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t('developerToolsTitle')}</ItemTitle>
                    <ItemDescription>{t('developerToolsDesc')}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto">
                    <Button variant="outline" size="sm" onClick={() => void handleOpenDeveloperTools()}>
                      {t('openDeveloperTools')}
                    </Button>
                  </ItemActions>
                </Item>
              ) : null}

              <Item variant="outline" size="sm">
                <ItemMedia variant="icon"><Gauge /></ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('performanceInfoTitle')}</ItemTitle>
                  <ItemDescription>{t('performanceInfoDesc')}</ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <Switch
                    checked={developerPerformanceInfo}
                    onCheckedChange={setDeveloperPerformanceInfo}
                    aria-label={t('performanceInfoTitle')}
                  />
                </ItemActions>
              </Item>

              <DeveloperDiagnostics />
            </div>
          ) : null}
        </ItemGroup>
      </SettingSection>
    </>
  )
}
