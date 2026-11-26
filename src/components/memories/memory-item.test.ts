// @vitest-environment jsdom
// Fork（almanac ALMNC-84.2）：記憶的刪除動作與狀態改名為「封存／已封存」；刪標籤說明與實際行為一致。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'
import zhTW from '../../../messages/zh-TW.json'
import type { Memory } from '@/db/memories'

const mocks = vi.hoisted(() => ({
  archiveMemory: vi.fn(async () => {}),
  restoreMemory: vi.fn(async () => {}),
  trashMemory: vi.fn(async () => {}),
  permanentlyDeleteMemory: vi.fn(async () => {}),
  approveMemory: vi.fn(async () => {}),
  updateMemory: vi.fn(async () => {}),
  setSystemPrompt: vi.fn(async () => {}),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/stores/memories', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      approveMemory: mocks.approveMemory,
      archiveMemory: mocks.archiveMemory,
      restoreMemory: mocks.restoreMemory,
      trashMemory: mocks.trashMemory,
      permanentlyDeleteMemory: mocks.permanentlyDeleteMemory,
      updateMemory: mocks.updateMemory,
    })),
  }
})
vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ systemPrompt: '', setSystemPrompt: mocks.setSystemPrompt })) }
})
vi.mock('./memory-form', () => ({ MemoryForm: () => null }))
vi.mock('@/components/responsive-action-menu', () => ({
  ResponsiveActionMenu: ({ items }: { items: Array<{ key: string; label: React.ReactNode; onSelect: () => void }> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'memory-actions' },
      items.map(item =>
        React.createElement('button', { key: item.key, type: 'button', 'data-action': item.key, onClick: item.onSelect }, item.label),
      ),
    ),
}))

const { MemoryItem } = await import('./memory-item')

let container: HTMLDivElement
let root: Root

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    content: '偏好繁體中文回覆',
    embedding: '[]',
    category: 'preference',
    kind: 'preference',
    scopeType: 'global',
    scopeId: '',
    applyMode: 'relevant',
    status: 'active',
    sensitivity: 'normal',
    origin: 'manual',
    confidence: 1,
    accessCount: 0,
    lastAccessedAt: 1,
    indexingStatus: 'ready',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function renderMemory(item: Memory, locale: 'zh-TW' | 'en', messages: typeof zhTW | typeof en) {
  await act(async () => {
    root.render(
      React.createElement(
        NextIntlClientProvider,
        {
          locale,
          messages,
          timeZone: 'Asia/Taipei',
        } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
        React.createElement(MemoryItem, { memory: item }),
      ),
    )
  })
}

describe('MemoryItem & tag copy (ALMNC-84.2)', () => {
  it('繁中記憶動作顯示「封存」、狀態顯示「已封存」，封存後 toast 也寫封存', async () => {
    await renderMemory(memory({ status: 'active' }), 'zh-TW', zhTW)
    const archiveBtn = container.querySelector<HTMLButtonElement>('[data-action="archive"]')!
    expect(archiveBtn.textContent).toBe('封存')
    await act(async () => archiveBtn.click())
    expect(mocks.archiveMemory).toHaveBeenCalledWith('m1')
    expect(mocks.toast).toHaveBeenCalledWith('已封存記憶', expect.any(Object))

    await renderMemory(memory({ status: 'archived' }), 'zh-TW', zhTW)
    expect(container.textContent).toContain('已封存')
    expect(container.textContent).not.toContain('已刪除')
  })

  it('英文記憶動作顯示 Archive、狀態顯示 Archived', async () => {
    await renderMemory(memory({ status: 'active' }), 'en', en)
    expect(container.querySelector('[data-action="archive"]')?.textContent).toBe('Archive')

    await renderMemory(memory({ status: 'archived' }), 'en', en)
    expect(container.textContent).toContain('Archived')
  })

  it('三語刪標籤說明皆反映記錄會移入垃圾桶與子標籤限制', () => {
    expect(zhTW.record.tagging.deleteTagHelp).toContain('移入垃圾桶')
    expect(zhTW.record.tagging.deleteTagHelp).not.toContain('記錄不會刪除')
    expect(en.record.tagging.deleteTagHelp).toContain('moved to Trash')
    expect(en.record.tagging.deleteTagHelp).not.toContain('Records will be kept')
    expect(zh.record.tagging.deleteTagHelp).toContain('移入回收站')
    expect(zh.record.tagging.deleteTagHelp).not.toContain('记录不会删除')
  })

  it('封存記憶確認刪除後會呼叫 trashMemory 而非永久刪除 (ALMNC-84.5)', async () => {
    await renderMemory(memory({ status: 'archived' }), 'zh-TW', zhTW)
    const deleteBtn = container.querySelector<HTMLButtonElement>('[data-action="delete"]')!
    expect(deleteBtn.textContent).toBe('移到最近刪除')

    await act(async () => deleteBtn.click())
    const confirmAction = document.body.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]')!
    expect(confirmAction.textContent).toBe('移到最近刪除')

    await act(async () => confirmAction.click())
    expect(mocks.trashMemory).toHaveBeenCalledWith('m1')
    expect(mocks.permanentlyDeleteMemory).not.toHaveBeenCalled()
  })
})
