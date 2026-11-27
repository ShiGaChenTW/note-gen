// Fork（almanac ALMNC-86）：提示詞功能關閉時，Agent 自訂指引、自訂對話角色、對話提示詞一律不生效；
// 只在讀取時忽略，store 原值不刪；開關打開後恢復生效。開關兩種狀態都要測。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const flag = vi.hoisted(() => ({ enabled: false }))
vi.mock('@/lib/prompt-library/feature', () => ({
  get PROMPT_LIBRARY_ENABLED() { return flag.enabled },
}))

const storeData = new Map<string, unknown>()
const storeSet = vi.fn(async (key: string, value: unknown) => { storeData.set(key, value) })
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(async () => ({
      get: async (key: string) => storeData.get(key),
      set: storeSet,
      save: vi.fn(async () => undefined),
    })),
  },
}))

const { resolveConversationSystemPrompt, resolveEffectivePrompt } = await import('./effective')
const { getSystemPromptContent, getPromptContent } = await import('@/lib/ai/utils')

const defaultRole = { id: '0', title: '写作助手', content: '預設角色內容', isDefault: true }
const customRole = { id: '42', title: '律師', content: '請扮演律師', isDefault: false }

beforeEach(() => {
  storeData.clear()
  storeSet.mockClear()
  storeData.set('agentSystemPromptExtension', '  一律用文言文回答  ')
  storeData.set('promptList', [defaultRole, customRole])
  storeData.set('currentPromptId', customRole.id)
})

afterEach(() => {
  flag.enabled = false
})

describe('提示詞功能關閉（PROMPT_LIBRARY_ENABLED=false）', () => {
  beforeEach(() => { flag.enabled = false })

  it('Agent 自訂指引不進入系統提示，store 原值不讀也不改', async () => {
    await expect(getSystemPromptContent()).resolves.toBe('')
    expect(storeSet).not.toHaveBeenCalled()
    expect(storeData.get('agentSystemPromptExtension')).toBe('  一律用文言文回答  ')
  })

  it('舊版 systemPrompt 也不會被搬進自訂指引', async () => {
    storeData.delete('agentSystemPromptExtension')
    storeData.set('systemPrompt', '舊的自訂提示')
    await expect(getSystemPromptContent()).resolves.toBe('')
    expect(storeSet).not.toHaveBeenCalled()
  })

  it('對話提示詞（conversation_prompt）不生效', () => {
    expect(resolveConversationSystemPrompt('用這個提示詞開新對話')).toBeUndefined()
  })

  it('已選的自訂角色不生效，一律用預設角色，currentPromptId 保留', async () => {
    expect(resolveEffectivePrompt([defaultRole, customRole], customRole)).toBe(defaultRole)
    expect(resolveEffectivePrompt([customRole], customRole)).toBe(customRole)
    expect(resolveEffectivePrompt([], customRole)).toBeNull()
    await expect(getPromptContent()).resolves.toBe('預設角色內容')
    expect(storeData.get('currentPromptId')).toBe('42')
    expect(storeSet).not.toHaveBeenCalled()
  })
})

describe('提示詞功能打開（PROMPT_LIBRARY_ENABLED=true）', () => {
  beforeEach(() => { flag.enabled = true })

  it('store 裡的 Agent 自訂指引恢復生效', async () => {
    await expect(getSystemPromptContent()).resolves.toBe('一律用文言文回答')
  })

  it('對話提示詞恢復生效', () => {
    expect(resolveConversationSystemPrompt('  用這個提示詞開新對話 ')).toBe('用這個提示詞開新對話')
    expect(resolveConversationSystemPrompt('   ')).toBeUndefined()
    expect(resolveConversationSystemPrompt(undefined)).toBeUndefined()
  })

  it('已選的自訂角色恢復生效', async () => {
    expect(resolveEffectivePrompt([defaultRole, customRole], customRole)).toBe(customRole)
    await expect(getPromptContent()).resolves.toBe('請扮演律師')
  })
})
