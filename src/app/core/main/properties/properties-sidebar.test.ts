// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'

const ui = create<{ activeRightView: string | null, setActiveRightView: (key: string | null) => void }>(set => ({
  activeRightView: null,
  setActiveRightView: key => set({ activeRightView: key }),
}))
const plugins = create(() => ({ installed: [], deviceSettings: {}, currentWorkspaceId: null, workspaceStates: {} }))
vi.mock('@/lib/plugins/ui-registry', () => ({ usePluginUiStore: ui }))
vi.mock('@/stores/plugins', () => ({ usePluginStore: plugins }))
vi.mock('@/lib/plugins/localization', () => ({ usePluginLocalization: () => {} }))
vi.mock('@/lib/plugins/display-preferences', () => ({ isPluginDisplayVisible: () => true }))
vi.mock('@/lib/plugins/internal-types', () => ({ isPluginEnabledInWorkspace: () => true }))
vi.mock('@/app/core/setting/plugins/plugin-display', () => ({ resolvePluginViewTitle: () => 'plugin' }))
vi.mock('@/components/plugins/plugin-icon', () => ({ PluginIcon: () => null }))
vi.mock('@/components/plugins/plugin-view-surface', () => ({ PluginViewSurface: () => null }))
vi.mock('@/app/core/main/chat', () => ({ default: () => React.createElement('div', null, 'chat content') }))
vi.mock('@/app/core/main/backlinks/backlinks-panel', () => ({ default: () => React.createElement('div', null, 'backlinks content') }))
vi.mock('./properties-panel', () => ({ default: () => React.createElement('div', null, 'properties content') }))
vi.mock('next-intl', () => ({ useLocale: () => 'zh-TW', useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}` }))
const { PluginRightSidebar } = await import('@/components/plugins/plugin-right-sidebar')
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  ui.setState({ activeRightView: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('屬性面板掛載', () => {
  it('沒有外掛時仍依序顯示對話、反向連結、屬性，且切換時保留掛載', async () => {
    await act(async () => root.render(React.createElement(PluginRightSidebar)))
    const tabs = container.querySelectorAll('[role="tab"]')
    expect([...tabs].map(tab => tab.getAttribute('aria-label'))).toEqual(['settings.plugins.ui.chat', 'backlinks.title', 'properties.title'])
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(3)
    expect(container.textContent).toContain('chat content')
    expect(container.textContent).toContain('backlinks content')
    expect(container.textContent).toContain('properties content')
    const panels = container.querySelectorAll('[role="tabpanel"]')
    expect(panels[1].className).toContain('data-[state=inactive]:hidden')
    await act(async () => {
      tabs[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    })
    expect(ui.getState().activeRightView).toBe('@backlinks')
    expect(panels[1].getAttribute('data-state')).toBe('active')
    expect(panels[0].getAttribute('data-state')).toBe('inactive')
    await act(async () => {
      tabs[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    })
    expect(ui.getState().activeRightView).toBeNull()
    await act(async () => tabs[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    expect(ui.getState().activeRightView).toBe('@properties')
    expect(panels[2].getAttribute('data-state')).toBe('active')
    expect(panels[2].className).toContain('data-[state=inactive]:hidden')
    await act(async () => ui.setState({ activeRightView: 'missing:plugin' }))
    expect(ui.getState().activeRightView).toBeNull()
  })
})
