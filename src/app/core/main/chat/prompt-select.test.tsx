// Fork（almanac ALMNC-86）：提示詞功能關閉時，對話角色選單顯示預設角色並停用，已選的自訂角色不生效；
// 開關打開後恢復顯示、可切換已選的自訂角色。store 裡的 currentPromptId 不被改掉。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderV3, screen } from '@/test/render-v3'

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

const { PromptSelect } = await import('./prompt-select')
const { default: usePromptStore } = await import('@/stores/prompt')

const defaultRole = { id: '0', title: '写作助手', content: '預設角色內容', isDefault: true }
const customRole = { id: '42', title: '律師', content: '請扮演律師' }

beforeEach(() => {
  storeData.clear()
  storeSet.mockClear()
  storeData.set('promptList', [defaultRole, customRole])
  storeData.set('currentPromptId', customRole.id)
  usePromptStore.setState({ promptList: [defaultRole], currentPrompt: null })
})

afterEach(() => {
  flag.enabled = false
})

describe('PromptSelect（ALMNC-86）', () => {
  it('提示詞功能關閉時顯示預設角色、選單停用，已選的自訂角色保留在 store', async () => {
    flag.enabled = false
    renderV3(<PromptSelect display="status" />)

    const trigger = await screen.findByRole('button', { name: '選擇對話角色' })
    await vi.waitFor(() => expect(usePromptStore.getState().currentPrompt?.id).toBe('42'))
    expect(trigger).toHaveTextContent('寫作助手')
    expect(trigger).not.toHaveTextContent('律師')
    expect(trigger).toBeDisabled()
    expect(storeData.get('currentPromptId')).toBe('42')
    expect(storeSet).not.toHaveBeenCalledWith('currentPromptId', expect.anything())
  })

  it('提示詞功能打開時恢復顯示已選的自訂角色，並可切換', async () => {
    flag.enabled = true
    const { user } = renderV3(<PromptSelect display="status" />)

    const trigger = await screen.findByRole('button', { name: '選擇對話角色' })
    await vi.waitFor(() => expect(trigger).toHaveTextContent('律師'))
    expect(trigger).toBeEnabled()

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: '寫作助手' }))
    await vi.waitFor(() => expect(storeData.get('currentPromptId')).toBe('0'))
  })
})
