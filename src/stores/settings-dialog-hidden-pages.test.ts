// almanac ALMNC-83.1、83.3、83.4：設定頁隱藏清單與選單名稱。
import { describe, expect, it } from 'vitest'
import { PROMPT_LIBRARY_ENABLED } from '@/lib/prompt-library/feature'
import {
  classicOnlySettingSections,
  disabledSettingSections,
  isSettingSectionVisible,
  settingSectionTitleKey,
} from './settings-dialog'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import zhTW from '../../messages/zh-TW.json'

describe('settings pages hidden by ALMNC-83 (83.1 / 83.3 / 83.4)', () => {
  it('hides record and template in the new UI only (ALMNC-83.4)', () => {
    expect(classicOnlySettingSections).toEqual(expect.arrayContaining(['record', 'template']))
    for (const section of ['record', 'template']) {
      expect(isSettingSectionVisible(section, true)).toBe(false)
      expect(isSettingSectionVisible(section, false)).toBe(true)
    }
  })

  it('hides the prompt page in both UIs while the prompt library is off (ALMNC-83.3)', () => {
    expect(PROMPT_LIBRARY_ENABLED).toBe(false)
    expect(disabledSettingSections).toContain('prompt')
    expect(isSettingSectionVisible('prompt', true)).toBe(false)
    expect(isSettingSectionVisible('prompt', false)).toBe(false)
  })

  it('keeps the rag page in both UIs but names it 語意檢索 in the new UI (ALMNC-83.1)', () => {
    expect(isSettingSectionVisible('rag', true)).toBe(true)
    expect(isSettingSectionVisible('rag', false)).toBe(true)
    expect(settingSectionTitleKey('rag', true)).toBe('rag.semanticTitle')
    expect(settingSectionTitleKey('rag', false)).toBe('rag.title')
    expect(settingSectionTitleKey('ai', true)).toBe('ai.menuTitle')
    expect(settingSectionTitleKey('editor', true)).toBe('editor.title')
    expect(zhTW.settings.rag.semanticTitle).toBe('語意檢索')
    expect(en.settings.rag.semanticTitle).toBe('Semantic search')
    expect(zh.settings.rag.semanticTitle).toBe('语义检索')
  })

  it('keeps LLM Wiki out of the new-UI semantic search copy (ALMNC-83.1)', () => {
    for (const messages of [zhTW, en, zh]) {
      const rag = messages.settings.rag
      for (const text of [rag.semanticTitle, rag.semanticDesc, rag.semanticCardDescription, rag.semanticChatDescription]) {
        expect(text).not.toMatch(/wiki|知識庫|知识库/i)
      }
    }
  })
})
