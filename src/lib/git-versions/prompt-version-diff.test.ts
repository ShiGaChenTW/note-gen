import { describe, expect, it } from 'vitest'
import { hasUnconfirmedPromptVersionChange, type PromptVersionBaseline } from './prompt-version-diff'

describe('hasUnconfirmedPromptVersionChange', () => {
  it('is unconfirmed when there is no prompt version yet and the note has content', () => {
    const baseline: PromptVersionBaseline = { hasPromptVersion: false, content: null }
    expect(hasUnconfirmedPromptVersionChange('# 第一版\n', baseline)).toBe(true)
  })

  it('is not unconfirmed when there is no prompt version yet but the note is blank', () => {
    const baseline: PromptVersionBaseline = { hasPromptVersion: false, content: null }
    expect(hasUnconfirmedPromptVersionChange('   \n', baseline)).toBe(false)
  })

  it('is unconfirmed when the current content differs from the latest prompt version', () => {
    const baseline: PromptVersionBaseline = { hasPromptVersion: true, content: '舊內容' }
    expect(hasUnconfirmedPromptVersionChange('新內容', baseline)).toBe(true)
  })

  it('is not unconfirmed when the current content matches the latest prompt version', () => {
    const baseline: PromptVersionBaseline = { hasPromptVersion: true, content: '內容' }
    expect(hasUnconfirmedPromptVersionChange('內容', baseline)).toBe(false)
  })

  it('ignores auto-snapshot catch-up: baseline stays the last prompt version, not HEAD', () => {
    // 自動快照已經把這次修改收進 HEAD，但比較基準仍然是最新一筆 prompt-version 的內容，
    // 所以只要跟那一版不同，照樣要算未確認（#56）。
    const baseline: PromptVersionBaseline = { hasPromptVersion: true, content: '上一個提示詞版本' }
    expect(hasUnconfirmedPromptVersionChange('自動快照已經收進的新內容', baseline)).toBe(true)
  })
})
