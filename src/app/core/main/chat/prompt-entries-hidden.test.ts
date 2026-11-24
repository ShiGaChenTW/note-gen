// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，對話狀態列（ChatFooter）與對話工具選單（ChatToolsPopover）不列對話角色。
// PromptSelect 換成標記元素；對照組把開關切成 true，證明標記確實會被偵測到。
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

const marker = (name: string) => (props: Record<string, unknown>) => h('div', { 'data-marker': name, 'data-display': String(props.display ?? '') })
vi.mock('./prompt-select', () => ({ PromptSelect: marker('prompt-select') }))
vi.mock('./model-select', () => ({ ModelSelect: marker('model-select') }))
vi.mock('./reasoning-select', () => ({ ReasoningSelect: marker('reasoning-select') }))
vi.mock('./mcp-button', () => ({ McpServerList: marker('mcp-server-list') }))
vi.mock('./clipboard-monitor', () => ({ ClipboardMonitor: marker('clipboard-monitor') }))
vi.mock('../status-bar-order', () => ({ StatusBarItem: ({ id, children }: { id: string; children: React.ReactNode }) => h('div', { 'data-status-item': id }, children) }))
// Radix Popover 只在開啟時才掛內容；這裡讓內容直接渲染，才看得到選單裡有哪些項目。
vi.mock('@/components/ui/popover', () => {
  const pass = ({ children }: { children?: React.ReactNode }) => h(React.Fragment, null, children)
  return { Popover: pass, PopoverTrigger: pass, PopoverContent: pass, PopoverHeader: pass, PopoverTitle: pass }
})

const { ChatFooter } = await import('./chat-footer')
const { ChatToolsPopover } = await import('./chat-tools-popover')

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

const promptMarkers = () => host.querySelectorAll('[data-marker="prompt-select"]')

describe('ALMNC-83.3 chat prompt entries follow PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('ChatFooter (standalone) shows the model but no 對話角色 PromptSelect', async () => {
    await render(h(ChatFooter))
    expect(host.querySelector('[data-marker="model-select"]')).not.toBeNull()
    expect(promptMarkers()).toHaveLength(0)
  })

  it('ChatFooter (embedded status bar) has no system:prompt item', async () => {
    await render(h(ChatFooter, { embedded: true }))
    expect(host.querySelector('[data-status-item="system:model"]')).not.toBeNull()
    expect(host.querySelector('[data-status-item="system:prompt"]')).toBeNull()
    expect(promptMarkers()).toHaveLength(0)
  })

  it('ChatToolsPopover lists model/reasoning but no 對話角色 PromptSelect', async () => {
    await render(h(ChatToolsPopover))
    expect(host.textContent).toContain(zhTW.record.chat.input.toolsMenu.groups.conversation)
    expect(host.querySelector('[data-marker="model-select"]')).not.toBeNull()
    expect(host.querySelector('[data-marker="reasoning-select"]')).not.toBeNull()
    expect(promptMarkers()).toHaveLength(0)
  })

  it('control: with the flag on, the same harness does find PromptSelect in all three places', async () => {
    flag.value = true
    await render(h(ChatFooter))
    expect(promptMarkers()).toHaveLength(1)
    await render(h(ChatFooter, { embedded: true }))
    expect(host.querySelector('[data-status-item="system:prompt"] [data-marker="prompt-select"]')).not.toBeNull()
    await render(h(ChatToolsPopover))
    expect(host.querySelector('[data-marker="prompt-select"][data-display="panel"]')).not.toBeNull()
  })
})
