// @vitest-environment jsdom
import React, { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import usePromptLibraryStore from '@/stores/prompt-library'
import { usePluginStore } from '@/stores/plugins'
import { getPluginManifestFingerprint, type InstalledPlugin } from '@/lib/plugins/internal-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import useDecideStore from '@/stores/decide'
import useCollectStore from '@/stores/collect'
import useThreadsStore from '@/stores/threads'
import { useWeekOverlay } from '@/lib/week/overlay'
import { useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { useWorkspaceCovered } from '@/lib/fork-overlays/use-page-visibility'
import { MainStatusBar, MainStatusBarPortal, WorkspaceCoveredContext } from './main-status-bar'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('localStorage', { getItem: () => null })
})

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => ({ get: async () => undefined }) } }))
vi.mock('./file/file-footer', () => ({ FileFooter: () => 'workspace' }))
vi.mock('./chat/chat-footer', () => ({ ChatFooter: () => 'model and writing assistant' }))
vi.mock('./unified-sync-status', () => ({ UnifiedSyncStatus: () => 'sync' }))
vi.mock('./today/today-status-item', () => ({ TodayStatusItem: () => 'today' }))
vi.mock('./daily/daily-calendar', () => ({ DailyNavStatusItem: () => 'date' }))
vi.mock('@/components/plugins/plugin-embedded-views', () => ({
  PluginEmbeddedView: () => null,
  useEmbeddedPluginViews: () => [],
}))

function statusPlugin(id: string): InstalledPlugin {
  return {
    manifest: {
      manifestVersion: 1,
      id,
      name: id,
      version: '1.0.0',
      apiVersion: '^1.0.0',
      minAppVersion: '0.0.0',
      platforms: ['desktop'],
      activationEvents: [],
      permissions: {},
      contributes: { statusBar: [{ id: 'count', alignment: 'left' }] },
    },
    source: 'development',
    activeVersion: '1.0.0',
    pendingActivation: false,
    installedAt: '',
    contentHash: id,
    verified: false,
  }
}

const editorStats = statusPlugin('top.notegen.editor-statistics')
const globalStatus = statusPlugin('test.global.status')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useUiModeStore.setState({ mode: 'v3' })
  useHomeStore.setState({ visible: false, loaded: false })
  usePluginStore.setState({
    installed: [editorStats, globalStatus],
    currentWorkspaceId: 'test-workspace',
    workspaceStates: {
      'test-workspace': Object.fromEntries([editorStats, globalStatus].map(plugin => [plugin.manifest.id, {
        enablement: 'workspace',
        enabledFingerprint: getPluginManifestFingerprint(plugin),
        settings: {},
        permissions: {},
      }])),
    },
    statusBar: {
      'top.notegen.editor-statistics:count': { visible: true, text: 'editor stats', updatedAt: 0 },
      'test.global.status:count': { visible: true, text: 'global plugins', updatedAt: 0 },
    },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Workspace() {
  const covered = useWorkspaceCovered()
  return createElement(React.Fragment, null,
    createElement(TooltipProvider, null, createElement(MainStatusBar, { workspaceCovered: covered })),
    createElement(WorkspaceCoveredContext.Provider, { value: covered },
      createElement(MainStatusBarPortal, null, createElement('button', null, 'copy editor text')),
    ),
  )
}

it('hides editor controls only while the Today page is loaded and visible in v3', () => {
  act(() => root.render(createElement(Workspace)))
  act(() => useHomeStore.setState({ visible: true }))
  expect(host.textContent).toContain('copy editor text')

  act(() => useHomeStore.setState({ loaded: true }))
  expect(host.textContent).not.toContain('copy editor text')
  expect(host.textContent).not.toContain('editor stats')
  for (const label of ['workspace', 'sync', 'model and writing assistant', 'date', 'global plugins']) {
    expect(host.textContent).toContain(label)
  }
  // Fork（almanac ALMNC-56.7，P05）：V3 的狀態列不放「需處理」。
  expect(host.textContent).not.toContain('today')

  act(() => useHomeStore.setState({ visible: false }))
  expect(host.textContent).toContain('copy editor text')
  expect(host.textContent).toContain('editor stats')

  act(() => {
    useUiModeStore.setState({ mode: 'classic' })
    useHomeStore.setState({ visible: true })
  })
  expect(host.textContent).toContain('copy editor text')
  expect(host.textContent).toContain('today')
})

it.each([
  ['Decide', (visible: boolean) => useDecideStore.setState({ visible })],
  ['Collect', (visible: boolean) => useCollectStore.setState({ visible })],
  ['Inbox', (visible: boolean) => useInboxStore.setState({ visible })],
  ['Threads', (visible: boolean) => useThreadsStore.setState({ visible })],
  ['Knowledge', (visible: boolean) => useKnowledgeOverlay.setState({ visible })],
  ['Prompt Library', (visible: boolean) => usePromptLibraryStore.setState({ visible })],
  ['Plan', (visible: boolean) => useWeekOverlay.setState({ visible })],
] as const)('hides editor controls while %s covers the workspace and restores them on return', (_, setVisible) => {
  act(() => root.render(createElement(Workspace)))
  act(() => setVisible(true))
  expect(host.textContent).not.toContain('copy editor text')
  act(() => setVisible(false))
  expect(host.textContent).toContain('copy editor text')
})
