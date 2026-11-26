// Fork（almanac ALMNC-81 / ALMNC-94.1）：提示詞功能關閉時，對話輸入框的「/」選單不列出提示詞；指令照常列出（改寫為 renderV3 示範）。
import { expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import useVaultIndexStore from '@/stores/vault-index'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import { PROMPT_LIBRARY_ENABLED } from '@/lib/prompt-library/feature'
import { renderV3, screen } from '@/test/render-v3'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/core/main',
  useSearchParams: () => new URLSearchParams(),
}))

const { ChatComposerMenu } = await import('./chat-composer-menu')

const prompt: IndexedNote = {
  path: 'Prompts/週報摘要.md',
  mtime: 1,
  frontmatter: { type: 'prompt' },
  tasks: [],
  links: [],
  aliases: [],
  tags: [],
  headings: [],
  blockIds: [],
}

it('leaves prompts out of the / menu while the prompt feature is off', () => {
  expect(PROMPT_LIBRARY_ENABLED).toBe(false)
  useVaultIndexStore.getState().replaceAll(new Map([[prompt.path, prompt]]))
  const noop = vi.fn()

  renderV3(
    <ChatComposerMenu
      mode="command"
      query=""
      excludedItemKeys={new Set<string>()}
      onClose={noop}
      onCommandSelect={noop}
      onFileSelect={noop}
      onFolderSelect={noop}
      onRecordSelect={noop}
      onCanvasSelect={noop}
      onSkillSelect={noop}
      onPromptSelect={noop}
    />,
  )

  expect(screen.getByText(zhTW.record.chat.input.composerMenu.commands.summarize.label)).toBeInTheDocument()
  expect(screen.queryByText('週報摘要')).not.toBeInTheDocument()
  expect(screen.queryByText(zhTW.record.chat.input.composerMenu.prompts.title)).not.toBeInTheDocument()
})
