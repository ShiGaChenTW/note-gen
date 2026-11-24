import { describe, expect, it } from 'vitest'
import { buildKnowledgeTabs, resolveKnowledgeTab } from './knowledge'
import { PROMPT_LIBRARY_ENABLED } from '@/lib/prompt-library/feature'

// Fork（almanac ALMNC-81）：提示詞功能關閉時沒有「提示詞」頁籤
const BUILT_IN = ['timeline', 'canvases', 'noteTags', 'domains', ...(PROMPT_LIBRARY_ENABLED ? ['prompts'] : [])]

const plugins = [{ id: 'a.b:view', title: 'Plugin A' }, { id: 'c.d:other', title: 'Plugin C' }]

describe('knowledge tabs', () => {
  it('has the built-in tabs without plugins or outline', () => {
    expect(buildKnowledgeTabs({ outlineInSidebar: false, pluginTabs: [] }).map(tab => tab.id)).toEqual(BUILT_IN)
    expect(BUILT_IN.includes('prompts')).toBe(PROMPT_LIBRARY_ENABLED)
  })

  it('adds an outline tab only when the outline is placed in the sidebar', () => {
    const on = buildKnowledgeTabs({ outlineInSidebar: true, pluginTabs: [] })
    expect(on.map(tab => tab.id)).toEqual([...BUILT_IN, 'outline'])
    expect(on.at(-1)?.kind).toBe('outline')
  })

  it('adds one tab per plugin view after the built-ins, keeping the plugin title', () => {
    const tabs = buildKnowledgeTabs({ outlineInSidebar: false, pluginTabs: plugins })
    expect(tabs.slice(BUILT_IN.length)).toEqual([
      { id: 'a.b:view', kind: 'plugin', title: 'Plugin A' },
      { id: 'c.d:other', kind: 'plugin', title: 'Plugin C' },
    ])
  })

  it('orders outline before plugin tabs when both exist', () => {
    expect(buildKnowledgeTabs({ outlineInSidebar: true, pluginTabs: plugins }).map(tab => tab.id).slice(BUILT_IN.length))
      .toEqual(['outline', 'a.b:view', 'c.d:other'])
  })

  it('falls back to the first tab when the current one disappears', () => {
    const withPlugin = buildKnowledgeTabs({ outlineInSidebar: true, pluginTabs: plugins })
    expect(resolveKnowledgeTab('a.b:view', withPlugin)).toBe('a.b:view')
    const without = buildKnowledgeTabs({ outlineInSidebar: false, pluginTabs: [] })
    expect(resolveKnowledgeTab('a.b:view', without)).toBe('timeline')
    expect(resolveKnowledgeTab('outline', without)).toBe('timeline')
    expect(resolveKnowledgeTab('prompts', without)).toBe('timeline')
    // Fork（almanac ALMNC-54.23）：領域分頁是內建分頁，切過去就留在領域頁。
    expect(resolveKnowledgeTab('domains', without)).toBe('domains')
  })
})
