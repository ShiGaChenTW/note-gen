// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，手機對話設定抽屜與工具抽屜不列對話角色（PromptSelector）。
// PromptSelector 換成標記元素；對照組把開關切成 true，證明標記確實會被偵測到。
import React, { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: false }))

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  flag.value = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value } }
})

const marker = (name: string) => () => h('div', { 'data-marker': name })
vi.mock('./prompt-selector', () => ({ PromptSelector: marker('prompt-selector') }))
vi.mock('./model-selector', () => ({ ModelSelector: marker('model-selector') }))
vi.mock('./clipboard-toggle', () => ({ ClipboardToggle: marker('clipboard-toggle') }))
vi.mock('./mcp-selector', () => ({ McpSelector: marker('mcp-selector') }))
vi.mock('@/app/core/main/chat/reasoning-select', () => ({ ReasoningSelect: marker('reasoning-select') }))
vi.mock('@/components/tooltip-button', () => ({ TooltipButton: () => h('button', { type: 'button' }) }))
// vaul Drawer 只在開啟時才掛內容；這裡讓內容直接渲染，才看得到抽屜裡有哪些項目。
vi.mock('@/components/ui/drawer', () => {
  const pass = ({ children }: { children?: React.ReactNode }) => h(React.Fragment, null, children)
  return { Drawer: pass, DrawerTrigger: pass, DrawerContent: pass, DrawerHeader: pass, DrawerTitle: pass }
})

const { ChatSettingsDrawer } = await import('./chat-settings-drawer')
const { ChatToolsDrawer } = await import('./chat-tools-drawer')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  flag.value = flag.actual ?? false
})

async function render(node: React.ReactElement) {
  await act(async () => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: node })))
}

const promptMarker = () => host.querySelector('[data-marker="prompt-selector"]')

describe('ALMNC-83.3 mobile chat drawers follow PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('ChatSettingsDrawer lists model and clipboard but no 對話角色 PromptSelector', async () => {
    await render(h(ChatSettingsDrawer))
    expect(host.textContent).toContain(zhTW.mobile.chat.drawer.settings.title)
    expect(host.querySelector('[data-marker="model-selector"]')).not.toBeNull()
    expect(host.querySelector('[data-marker="clipboard-toggle"]')).not.toBeNull()
    expect(promptMarker()).toBeNull()
  })

  it('ChatToolsDrawer lists model/reasoning/MCP but no 對話角色 PromptSelector', async () => {
    await render(h(ChatToolsDrawer))
    expect(host.textContent).toContain(zhTW.record.chat.input.toolsMenu.groups.conversation)
    expect(host.querySelector('[data-marker="model-selector"]')).not.toBeNull()
    expect(host.querySelector('[data-marker="reasoning-select"]')).not.toBeNull()
    expect(host.querySelector('[data-marker="mcp-selector"]')).not.toBeNull()
    expect(promptMarker()).toBeNull()
  })

  it('control: with the flag on, both drawers do render PromptSelector', async () => {
    flag.value = true
    await render(h(ChatSettingsDrawer))
    expect(promptMarker()).not.toBeNull()
    await render(h(ChatToolsDrawer))
    expect(promptMarker()).not.toBeNull()
  })
})
