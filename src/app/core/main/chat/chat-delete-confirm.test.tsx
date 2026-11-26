import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderV3 } from '@/test/render-v3'

const mocks = vi.hoisted(() => ({
  switchConversation: vi.fn(async () => undefined),
  deleteConversation: vi.fn(async () => undefined),
  startNewConversation: vi.fn(async () => undefined),
  startTemporaryConversation: vi.fn(),
  openSummary: vi.fn(),
}))

vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      conversations: [
        {
          id: 10,
          syncId: 'conv-10',
          syncUpdatedAt: 100,
          title: '專案檢討對話',
          createdAt: 100,
          updatedAt: 100,
          messageCount: 3,
          isPinned: false,
        },
        {
          id: 11,
          syncId: 'conv-11',
          syncUpdatedAt: 90,
          title: '待刪除草稿對話',
          createdAt: 90,
          updatedAt: 90,
          messageCount: 2,
          isPinned: false,
        },
      ],
      currentConversationId: 10,
      isTemporaryConversation: false,
      chats: [{ id: 1 }],
      loading: false,
      switchConversation: mocks.switchConversation,
      deleteConversation: mocks.deleteConversation,
      startNewConversation: mocks.startNewConversation,
      startTemporaryConversation: mocks.startTemporaryConversation,
    })),
  }
})

vi.mock('@/stores/threads', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({ chatHost: null })),
  }
})

vi.mock('../conversation-summary/summary-dialog', () => ({
  ConversationSummaryButton: () => null,
}))

vi.mock('../jobs/create-job', () => ({
  CreateJobButton: () => null,
}))

vi.mock('../threads/thread-status', () => ({
  ThreadTagPrefix: () => null,
  useCurrentThreadTag: () => undefined,
}))

vi.mock('@/lib/conversation-summary', () => ({
  useConversationSummaryStore: (selector: (state: { open: typeof mocks.openSummary }) => unknown) =>
    selector({ open: mocks.openSummary }),
}))

const { ChatHeader } = await import('./chat-header')

describe('ChatHeader conversation delete confirmation (ALMNC-84.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('點擊刪除對話先開啟確認對話框，取消不刪除、確認才呼叫 deleteConversation', async () => {
    const { user } = renderV3(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: /專案檢討對話|歷史對話/ }))
    const deleteButtons = await screen.findAllByRole('button', { name: '刪除對話' })
    await user.click(deleteButtons[1]!)

    const cancelDialog = await screen.findByRole('alertdialog')
    expect(within(cancelDialog).getByText('確定要刪除這段對話嗎？')).toBeInTheDocument()
    expect(mocks.deleteConversation).not.toHaveBeenCalled()

    await user.click(within(cancelDialog).getByRole('button', { name: '取消' }))
    expect(mocks.deleteConversation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /專案檢討對話|歷史對話/ }))
    const deleteButtonsAgain = await screen.findAllByRole('button', { name: '刪除對話' })
    await user.click(deleteButtonsAgain[1]!)

    const confirmDialog = await screen.findByRole('alertdialog')
    await user.click(within(confirmDialog).getByRole('button', { name: '移到最近刪除' }))
    expect(mocks.deleteConversation).toHaveBeenCalledWith(11)
  })
})
