// Fork（almanac ALMNC-54.20，AC#1）：對話摘要（對話結論）存檔後交給工作台登錄成系統產生的資料源；存檔失敗就不登錄。
import { beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  register: vi.fn<(summary: { conversation: string, content: string, path?: string }) => Promise<undefined>>(async () => undefined),
}))

vi.mock('@/db/chats', () => ({ getChatsByConversation: async () => [] }))
vi.mock('@/db/conversations', () => ({ getConversation: async () => undefined }))
vi.mock('@/lib/ai/chat', () => ({ fetchAi: async () => '' }))
vi.mock('@/stores/vault-index', () => ({ default: { getState: () => ({ notes: new Map() }) } }))
vi.mock('@/lib/daily/note-io', () => ({
  readNote: async (path: string) => fake.files.get(path) ?? null,
  writeNote: async (path: string, content: string) => { fake.files.set(path, content) },
}))
vi.mock('@/lib/workbench/actions', () => ({ registerConversationConclusion: fake.register }))

const { saveSummary } = await import('./index')

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  fake.files.clear()
  fake.register.mockClear()
})

it('registers the saved summary as the conversation conclusion, keyed by the conversation', async () => {
  await saveSummary({ path: '/對話摘要/a.md', content: '## 決議\n- 下週出貨', existingPath: null, conversation: 'sync-1' })
  await settle()
  expect(fake.files.get('對話摘要/a.md')).toBe('## 決議\n- 下週出貨')
  expect(fake.register).toHaveBeenCalledWith({ conversation: 'sync-1', content: '## 決議\n- 下週出貨', path: '對話摘要/a.md' })
})

it('does not register when the save is refused', async () => {
  fake.files.set('對話摘要/a.md', '別的筆記')
  await expect(saveSummary({ path: '對話摘要/a.md', content: 'x', existingPath: null, conversation: 'sync-1' })).rejects.toThrow('EXISTS:')
  await settle()
  expect(fake.register).not.toHaveBeenCalled()
})
