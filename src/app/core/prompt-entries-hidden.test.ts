// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，桌面主框架同步給托盤選單的記錄工具清單不含 Prompt 素材（設定值保留）。
// 渲染真正的 RootLayout，子元件、啟動流程與 Tauri API 換掉，攔下 invoke('update_tray_record_toolbar_config') 的參數。
// 對照組把開關切成 true，證明同一套 harness 看得到 prompt-draft 被送進托盤。
import React, { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../messages/zh-TW.json'

await vi.hoisted(async () => { vi.stubGlobal('React', (await import('react')).default) })

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: undefined as boolean | undefined }))
const fx = vi.hoisted(() => {
  const never = () => new Promise<never>(() => {})
  // 同時支援 useX()、useX(selector) 與 useX.getState() 的假 store。
  const store = <T extends object>(state: T) => Object.assign(
    (selector?: (s: T) => unknown) => (selector ? selector(state) : state),
    { getState: () => state },
  )
  return {
    never,
    store,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => []),
  }
})

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value ?? flag.actual } }
})

// 與 stores/setting 的預設值相同：prompt-draft 仍存在設定裡且啟用。
const RECORD_TOOLBAR_CONFIG = [
  { id: 'text', enabled: true, order: 0 },
  { id: 'recording', enabled: true, order: 1 },
  { id: 'scan', enabled: true, order: 2 },
  { id: 'image', enabled: true, order: 3 },
  { id: 'link', enabled: true, order: 4 },
  { id: 'file', enabled: true, order: 5 },
  { id: 'todo', enabled: true, order: 6 },
  { id: 'prompt-draft', enabled: true, order: 7 },
]

vi.mock('@tauri-apps/api/core', () => ({ invoke: fx.invoke }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ listen: async () => () => {}, setAlwaysOnTop: async () => {} }) }))
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/core/main',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/stores/setting', () => ({
  default: fx.store({
    initSettingData: fx.never, uiScale: 100, customThemeColors: undefined, appFontFamily: undefined,
    recordToolbarConfig: RECORD_TOOLBAR_CONFIG,
  }),
}))
vi.mock('@/stores/imageHosting', () => ({ default: fx.store({ initMainHosting: () => {} }) }))
vi.mock('@/stores/shortcut', () => ({ default: fx.store({ initShortcut: async () => {}, activeShortcuts: [], initialized: true, recordingShortcut: '' }) }))
vi.mock('@/stores/editor-shortcut', () => ({ default: fx.store({ initEditorShortcuts: async () => {} }) }))
vi.mock('@/stores/vector', () => ({ default: fx.store({ initVectorDb: async () => {} }) }))
vi.mock('@/stores/update', () => ({ default: fx.store({ initUpdateStore: async () => {}, checkForUpdates: async () => {} }) }))
vi.mock('@/stores/article', () => ({ default: fx.store({ fileTree: [], loadFileTree: async () => {}, setActiveFilePath: async () => {} }) }))
vi.mock('@/stores/sidebar', () => ({ useSidebarStore: fx.store({ leftSidebarVisible: true, toggleLeftSidebar: async () => {}, setLeftSidebarTab: async () => {} }) }))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ currentLocale: 'zh-TW' }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }) }))
vi.mock('@/db', () => ({ initAllDatabases: fx.never }))
vi.mock('@/lib/event-report', () => ({ reportAppStart: async () => {} }))
vi.mock('@/lib/shortcut/quick-record-text', () => ({ default: async () => () => {} }))
vi.mock('@/lib/shortcut/show-window', () => ({ default: () => {} }))
vi.mock('@/lib/mcp/init', () => ({ initMcp: async () => {} }))
vi.mock('@/lib/sync/auto-data-sync-queue', () => ({ initAutoDataSyncRuntime: async () => {} }))
vi.mock('@/lib/backup/managed-backup', () => ({ initManagedBackupRuntime: () => () => {} }))
vi.mock('@/lib/git-versions/auto-snapshot', () => ({ initGitVersionAutoSnapshotRuntime: () => () => {} }))
vi.mock('@/lib/opened-files', () => ({ resolveOpenedMarkdownPath: async () => null }))
vi.mock('@/lib/theme-utils', () => ({ applyThemeColors: () => {} }))
vi.mock('@/lib/font-settings', () => ({ applyAppFontFamily: () => {} }))
const none = () => null
const pass = ({ children }: { children?: React.ReactNode }) => children
vi.mock('@/components/theme-provider', () => ({ ThemeProvider: pass }))
vi.mock('@/contexts/text-size-context', () => ({ TextSizeProvider: pass }))
vi.mock('@/components/close-behavior-guard', () => ({ CloseBehaviorGuard: none }))
vi.mock('@/components/title-bar', () => ({ TitleBar: none }))
vi.mock('@/components/sync-confirm-dialog', () => ({ SyncConfirmDialog: none }))
vi.mock('./setting/components/settings-dialog', () => ({ SettingsDialog: none }))
vi.mock('@/components/memories/memory-auto-notifications', () => ({ MemoryAutoNotifications: none }))
vi.mock('@/components/web-clipper-bridge', () => ({ WebClipperBridge: none }))
vi.mock('@/components/local-mcp-bridge', () => ({ LocalMcpBridge: none }))
vi.mock('@/components/plugins/plugin-command-palette', () => ({ PluginCommandPalette: none }))
vi.mock('@/components/plugins/plugin-host-bridge', () => ({ PluginHostBridge: none }))
vi.mock('@/components/plugins/plugin-dialog-host', () => ({ PluginDialogHost: none }))
vi.mock('@/components/desktop-screenshot-bridge', () => ({ DesktopScreenshotBridge: none }))
vi.mock('./main/mark/desktop-record-controls', () => ({ DesktopRecordControls: none }))
vi.mock('./main/mark/unified-record-dialog', () => ({ UnifiedRecordDialog: none }))

const { default: RootLayout } = await import('./layout')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fx.invoke.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  flag.value = undefined
})

type TrayToolbarArgs = { config: { id: string; label: string }[] }

async function trayToolbarConfig() {
  await act(async () => root.render(h(NextIntlClientProvider, {
    locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(RootLayout, null, h('div', { 'data-marker': 'page' })),
  })))
  expect(host.querySelector('[data-marker="page"]')).not.toBeNull()
  const calls = fx.invoke.mock.calls.filter(([command]) => command === 'update_tray_record_toolbar_config')
  expect(calls.length).toBeGreaterThan(0)
  return (calls.at(-1)![1] as TrayToolbarArgs).config
}

describe('ALMNC-83.3 tray record menu follows PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('sends the record tools to the tray without prompt-draft even though the stored config has it enabled', async () => {
    const config = await trayToolbarConfig()
    expect(config.map(item => item.id)).toEqual(RECORD_TOOLBAR_CONFIG.filter(item => item.id !== 'prompt-draft').map(item => item.id))
    expect(config.find(item => item.id === 'todo')?.label).toBe(zhTW.record.mark.type.todo)
  })

  it('control: with the flag on, prompt-draft is sent to the tray', async () => {
    flag.value = true
    const config = await trayToolbarConfig()
    expect(config.map(item => item.id)).toEqual(RECORD_TOOLBAR_CONFIG.map(item => item.id))
  })
})
