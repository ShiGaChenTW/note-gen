// @vitest-environment jsdom
// almanac ALMNC-83.2：新介面沒有獨立的記憶管理分頁，對話 agent 的記憶（lib/memory，memories 表）改在
// 夥伴分頁的 Agent 設定區看與編輯；資料不搬、讀取點不變。classic 仍是設定 > 記憶管理。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import type { Memory } from '@/db/memories'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import zhTW from '../../../../../messages/zh-TW.json'

const fake = vi.hoisted(() => ({
  memories: [] as Memory[],
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))

// 只把資料庫換成記憶體：store、MemoryList 都用真的，確認 Agent 設定區讀的就是 memories 表那份資料。
vi.mock('@/db/memories', () => ({
  getAllMemories: async () => fake.memories,
  getMemoryStats: async () => ({ total: fake.memories.length, preferences: 0, memories: fake.memories.length, pending: 0, archived: 0, totalAccessCount: 0 }),
  approveMemory: vi.fn(), archiveMemory: vi.fn(), clearAllMemories: vi.fn(), permanentlyDeleteMemory: vi.fn(),
  restoreMemory: vi.fn(), undoMemoryChange: vi.fn(), updateMemory: vi.fn(), upsertMemory: vi.fn(),
}))
vi.mock('@/db/memory-policy', () => ({
  getMemoryPolicy: async () => ({ useMemories: true, generateMemories: true, excludeExternalContext: false, generationStartedAt: 0, updatedAt: 0 }),
  updateMemoryPolicy: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: fake.toast }))
vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useLocale: () => 'en',
    useTranslations: (namespace?: string) => intl.createTranslator({ locale: 'en', messages: en, namespace: namespace as never }),
  }
})

const { ChatMemorySettings } = await import('./chat-memory-settings')
const { MemoryAutoNotifications } = await import('@/components/memories/memory-auto-notifications')
const { default: emitter } = await import('@/lib/emitter')
const {
  fallbackSettingSection, isSettingSectionVisible, memorySettingSection, useSettingsDialogStore,
} = await import('@/stores/settings-dialog')

function memory(id: string, content: string): Memory {
  return {
    id, content, embedding: '', category: 'memory', kind: 'fact', scopeType: 'global', applyMode: 'relevant',
    status: 'active', origin: 'manual', confidence: 1, indexingStatus: 'ready', sensitivity: 'normal',
    accessCount: 0, lastAccessedAt: 0, createdAt: 1, updatedAt: 1,
  }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, {
    React, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  })
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  fake.memories = []
})

describe('記憶管理分頁的可見性', () => {
  it('新介面選單沒有記憶管理；classic 照舊有', () => {
    expect(isSettingSectionVisible('memories', true)).toBe(false)
    expect(isSettingSectionVisible('memories', false)).toBe(true)
  })

  it('新介面停在記憶管理（上次停的頁、舊深連結）時改停夥伴分頁；classic 不動', () => {
    expect(fallbackSettingSection('memories', true)).toBe('partners')
    expect(fallbackSettingSection('memories', false)).toBe('memories')
    expect(memorySettingSection(true)).toBe('partners')
    expect(memorySettingSection(false)).toBe('memories')
  })
})

describe('Agent 設定區的對話記憶', () => {
  it('列出 memories 表裡既有的對話記憶，可以新增', async () => {
    fake.memories = [memory('m1', 'Prefers replies in Traditional Chinese')]
    await act(async () => root.render(React.createElement(ChatMemorySettings)))
    expect(container.textContent).toContain(en.agents.chatMemory.title)
    const section = container.querySelector('[data-testid="agent-chat-memory"]')!
    expect(section.textContent).toContain('Prefers replies in Traditional Chinese')
    expect([...section.querySelectorAll('button')].some(button => button.textContent?.includes(en.settings.memories.addMemory))).toBe(true)
  })

  it('classic 的記憶管理頁與 Agent 設定區用同一個 MemoryList（同一份資料、同一組編輯動作）', () => {
    const here = join(__dirname)
    expect(readFileSync(join(here, 'chat-memory-settings.tsx'), 'utf8')).toContain("import { MemoryList } from '@/components/memories/memory-list'")
    expect(readFileSync(join(here, '../memories/page.tsx'), 'utf8')).toContain("import { MemoryList } from '@/components/memories/memory-list'")
  })

  it('對話 agent 仍從 memories 表讀記憶（讀取點沒有改到 agent-memory）', () => {
    const src = join(__dirname, '../../../..')
    for (const file of ['lib/context/loader.ts', 'lib/agent/tools/memory-tools.ts']) {
      const text = readFileSync(join(src, file), 'utf8')
      expect(text).toMatch(/from '@\/db\/memories'/)
      expect(text).not.toMatch(/agent-memory/)
    }
  })

  it('三種語系都有對話記憶的標題與說明', () => {
    for (const messages of [en, zh, zhTW]) {
      expect(Object.keys(messages.agents.chatMemory).sort()).toEqual(['desc', 'title'])
    }
    expect(zhTW.agents.chatMemory.title).toBe('對話記憶')
  })
})

describe('自動記憶通知的「檢視」', () => {
  async function clickReview() {
    useSettingsDialogStore.setState({ open: false, activeSection: 'about' })
    await act(async () => root.render(React.createElement(MemoryAutoNotifications)))
    fake.toast.warning.mockClear()
    await act(async () => emitter.emit('memory-auto-created', { conversationId: 1, created: [{ id: 'p', content: 'pending one', status: 'pending' }] }))
    const options = fake.toast.warning.mock.calls[0][1] as { action: { onClick: () => void } }
    act(() => options.action.onClick())
    return useSettingsDialogStore.getState()
  }

  it('新介面開夥伴分頁', async () => {
    useUiModeStore.setState({ mode: 'v3' })
    document.documentElement.dataset.ui = 'v3'
    const state = await clickReview()
    expect(state.open).toBe(true)
    expect(state.activeSection).toBe('partners')
  })

  it('classic 開記憶管理', async () => {
    useUiModeStore.setState({ mode: 'classic' })
    document.documentElement.dataset.ui = 'classic'
    const state = await clickReview()
    expect(state.activeSection).toBe('memories')
  })
})
