import { describe, expect, it } from 'vitest'

import { isSupportedLocale, loadMessagesWithFallback, normalizeLocale } from './config'

// Fork：上游把 zh-TW 移成插件；fork 保留內建，同步上游時不可以被改回去。
describe('內建繁體中文', () => {
  it('zh-TW 仍是內建語言，存過的選擇不會被重設', () => {
    expect(isSupportedLocale('zh-TW')).toBe(true)
    expect(normalizeLocale('zh-TW')).toBe('zh-TW')
  })

  it('載入繁中字串與 common，不是英文', async () => {
    const messages = await loadMessagesWithFallback('zh-TW') as {
      inbox: { noTags: string }
      common: { noteGenFree: string }
    }
    expect(messages.inbox.noTags).toBe('還沒有標籤')
    expect(messages.common.noteGenFree).toBe('免費')
  })

  it('繁中缺的字串退回簡中，不退回英文', async () => {
    const messages = await loadMessagesWithFallback('zh-TW') as {
      settings: { memories: { actions: { approve: string } } }
    }
    const zh = await loadMessagesWithFallback('zh') as typeof messages
    expect(messages.settings.memories.actions.approve).toBe(zh.settings.memories.actions.approve)
  })

  it('已移除的內建語言退回簡中，等語言插件接手', () => {
    expect(normalizeLocale('de')).toBe('zh')
  })
})
