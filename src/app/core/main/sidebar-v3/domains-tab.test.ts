// @vitest-environment jsdom
// Fork（almanac ALMNC-54.23）：領域頁——整理頁的「領域」分頁。領域清單（最多兩層）、各領域的知識筆記、
// 核心概念／重點結論／矛盾與未解問題來自領域總覽，沒有的顯示空狀態；classic 不出現。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import { useUiModeStore } from '@/lib/fork-ui'
import type { Domain } from '@/lib/v3-model/domain'
import type { IndexedNote } from '@/lib/vault-index/index-note'

const mocks = vi.hoisted(() => ({
  listDomains: vi.fn(async (): Promise<Domain[]> => []),
  revealInFileTree: vi.fn(async () => {}),
  setActiveFilePath: vi.fn(async () => {}),
}))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  })
})

vi.mock('@/db/v3-domains', () => ({ listDomains: mocks.listDomains }))
vi.mock('@/lib/daily/note-io', () => ({ revealInFileTree: mocks.revealInFileTree }))
vi.mock('@/stores/article', async () => {
  const { create } = await import('zustand')
  return { default: Object.assign(create(() => ({})), { getState: () => ({ setActiveFilePath: mocks.setActiveFilePath }) }) }
})
// 整理頁其餘分頁很重（畫布、時間軸、外掛），整頁測試只留領域分頁與頁首。
vi.mock('../canvas/canvas-sidebar', () => ({ CanvasActions: () => null, CanvasSidebar: () => null }))
vi.mock('../editor/markdown/outline', () => ({ Outline: () => null }))
vi.mock('../note-tags/note-tags-sidebar', () => ({ default: () => h('div', { 'data-testid': 'tags-tab' }) }))
vi.mock('../timeline/timeline-sidebar', () => ({ TimelineSidebar: () => h('div', { 'data-testid': 'timeline-tab' }) }))
vi.mock('@/components/plugins/plugin-view-surface', () => ({ PluginViewSurface: () => null }))
vi.mock('./use-vault-name', () => ({ useVaultName: () => 'MyVault' }))
vi.mock('./use-knowledge-tabs', () => ({
  useKnowledgeTabs: () => ['timeline', 'canvases', 'noteTags', 'domains', 'prompts'].map(id => ({ id, kind: 'builtin' as const })),
}))
vi.mock('@/stores/collect', async () => {
  const { create } = await import('zustand')
  return { default: Object.assign(create(() => ({})), { getState: () => ({ show: vi.fn() }) }) }
})
vi.mock('@/stores/inbox', async () => {
  const { create } = await import('zustand')
  return { default: Object.assign(create(() => ({})), { getState: () => ({ show: vi.fn() }) }) }
})
vi.mock('@/stores/prompt-library', async () => {
  const { create } = await import('zustand')
  return { default: Object.assign(create(() => ({})), { getState: () => ({ show: vi.fn() }) }) }
})
vi.mock('@/lib/inbox/use-inbox-pending', () => ({ useInboxPendingCount: () => 0 }))

const useVaultIndexStore = (await import('@/stores/vault-index')).default
const { useDomainPage, showDomainPage } = await import('@/lib/sidebar-v3/domain-page')
const { useKnowledgeOverlay } = await import('@/lib/sidebar-v3/knowledge')
const { DomainsTab } = await import('./domains-tab')
const { KnowledgeScreen } = await import('./knowledge-screen')

let container: HTMLDivElement
let root: Root

const domain = (id: string, name: string, parentId?: string, overview = ''): Domain => ({ id, name, parentId, overview, createdAt: Date.UTC(2026, 10, 20), updatedAt: Date.UTC(2026, 10, 22) })
const indexed = (path: string, frontmatter: Record<string, unknown> | null): IndexedNote =>
  ({ path, mtime: 0, frontmatter, tasks: [], links: [], aliases: [], tags: [], headings: [], blockIds: [] })

const OVERVIEW = [
  '# 資料工程', '', '## 總覽', '', '資料從來源到分析的整條管線。', '',
  '## 核心概念', '', '- 管線：把資料從來源搬到倉儲', '- 冪等：重跑不會重複寫入', '',
  '## 重點結論', '', '- 先確保冪等再談效能（[[knowledge/idempotent]]）', '',
  '## 矛盾與未解問題', '', '- [[knowledge/batch]] ↔ [[knowledge/stream]]：兩則對延遲的說法不同', '',
].join('\n')

function seedVault() {
  useVaultIndexStore.setState({
    status: 'ready',
    notes: new Map([
      ['knowledge/idempotent.md', indexed('knowledge/idempotent.md', { type: 'knowledge', title: '冪等寫入', summary: '重跑不會重複寫入', domains: ['data'] })],
      ['knowledge/batch.md', indexed('knowledge/batch.md', { type: 'knowledge', title: '批次處理', domains: ['data'], status: 'disputed' })],
      ['knowledge/stream.md', indexed('knowledge/stream.md', { type: 'knowledge', title: '串流處理', domains: ['data'] })],
      ['knowledge/rust.md', indexed('knowledge/rust.md', { type: 'knowledge', title: '所有權', domains: ['soft'] })],
      ['records/standup.md', indexed('records/standup.md', { type: 'record', title: '站會', domains: ['data'] })],
    ]),
  })
}

function render(messages: unknown = zhTW, locale = 'zh-TW', element: React.ComponentType = DomainsTab) {
  act(() => root.render(h(NextIntlClientProvider, { locale, messages: messages as typeof zhTW, timeZone: 'Asia/Taipei', children: h(element) })))
}
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const $ = (selector: string) => container.querySelector<HTMLElement>(selector)
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)]
const click = (el: HTMLElement | null | undefined) => { act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useUiModeStore.setState({ mode: 'v3' })
  useDomainPage.setState({ domainId: null })
  useKnowledgeOverlay.setState({ visible: false, tab: 'timeline' })
  mocks.listDomains.mockResolvedValue([
    domain('eng', '工程', undefined, '# 工程\n\n## 總覽\n\n軟硬體與資料的工程方法。\n'),
    domain('data', '資料工程', 'eng', OVERVIEW),
    domain('soft', '軟體工程', 'eng'),
    domain('ie', '工業工程'),
  ])
  seedVault()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('領域頁：列出領域（最多兩層）與知識筆記（ALMNC-54.23 AC #1）', () => {
  it('lists top-level domains with their sub-domains underneath and the number of 知識筆記 in each', async () => {
    render()
    await flush()
    const rows = $$('[data-testid="domain-row"]')
    const ids = rows.map(row => row.dataset.domain!)
    expect([...ids].sort()).toEqual(['data', 'eng', 'ie', 'soft'])
    // 下層緊接在它的上層後面，而且縮排比上層深。
    expect(ids.slice(ids.indexOf('eng') + 1, ids.indexOf('eng') + 3).sort()).toEqual(['data', 'soft'])
    const indent = (id: string) => parseInt(rows[ids.indexOf(id)].style.paddingInlineStart, 10)
    expect(indent('data')).toBeGreaterThan(indent('eng'))
    expect(indent('ie')).toBe(indent('eng'))
    const countOf = (name: string) => rows.find(row => row.querySelector('span')?.textContent === name)!.textContent
    expect(countOf('資料工程')).toContain('3')
    expect(countOf('軟體工程')).toContain('1')
  })

  it('shows an empty state with the next step when there are no domains', async () => {
    mocks.listDomains.mockResolvedValue([])
    render()
    await flush()
    expect($('[data-slot="empty-state"]')?.textContent).toContain('還沒有領域')
    expect($('[data-slot="empty-state"]')?.textContent).toContain('指揮官')
  })

  it('shows an error state when the domain table cannot be read', async () => {
    mocks.listDomains.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render()
    await flush()
    expect($('[data-slot="empty-state"]')?.textContent).toContain('讀取領域失敗')
  })

  it('opens a domain to list only its 知識筆記 (not 紀錄筆記), flags disputed ones, and opens a note on click', async () => {
    render()
    await flush()
    click($('[data-domain="data"]'))
    expect(useDomainPage.getState().domainId).toBe('data')
    expect($('h2')?.textContent).toBe('工程 › 資料工程')
    const notes = $$('[data-testid="domain-note"]')
    expect(notes.map(note => note.dataset.path).sort()).toEqual(['knowledge/batch.md', 'knowledge/idempotent.md', 'knowledge/stream.md'])
    expect($('[data-path="knowledge/batch.md"]')?.textContent).toContain('待查證')
    expect($('[data-path="knowledge/idempotent.md"]')?.textContent).toContain('重跑不會重複寫入')
    expect(container.textContent).not.toContain('站會')
    await act(async () => { $('[data-path="knowledge/idempotent.md"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(mocks.revealInFileTree).toHaveBeenCalledWith('knowledge/idempotent.md')
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('knowledge/idempotent.md')
  })

  it('goes back to the list, and moves between related domains (parent, sub-domain, same level)', async () => {
    render()
    await flush()
    click($('[data-domain="data"]'))
    const related = $('[data-testid="domain-related"]')!
    expect(related.textContent).toContain('工程')
    expect(related.textContent).toContain('軟體工程')
    click(related.querySelector<HTMLElement>('[data-domain="soft"]'))
    expect($('h2')?.textContent).toBe('工程 › 軟體工程')
    click($('[data-testid="domain-back"]'))
    expect($('[data-testid="domain-list"]')).not.toBeNull()
    expect(useDomainPage.getState().domainId).toBeNull()
  })

  it('says so when the selected domain no longer exists', async () => {
    useDomainPage.setState({ domainId: 'deleted' })
    render()
    await flush()
    expect($('[data-slot="empty-state"]')?.textContent).toContain('找不到這個領域')
  })
})

describe('領域頁：核心概念、重點結論、矛盾與未解問題來自領域資料（ALMNC-54.23 AC #2）', () => {
  it('shows the sections written in the domain overview, with source notes as links that open the note', async () => {
    useDomainPage.setState({ domainId: 'data' })
    render()
    await flush()
    expect($('[data-testid="domain-overview"]')?.textContent).toContain('資料從來源到分析的整條管線。')
    const concepts = $('[data-testid="domain-core-concepts"]')!
    expect(concepts.querySelector('h2')?.textContent).toContain('核心概念')
    expect([...concepts.querySelectorAll('li')].map(li => li.textContent)).toEqual(['管線：把資料從來源搬到倉儲', '冪等：重跑不會重複寫入'])
    const conclusions = $('[data-testid="domain-key-conclusions"]')!
    expect(conclusions.querySelector('h2')?.textContent).toContain('重點結論')
    expect(conclusions.textContent).toContain('先確保冪等再談效能')
    const source = conclusions.querySelector('button')!
    expect(source.textContent).toBe('knowledge/idempotent')
    await act(async () => { source.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('knowledge/idempotent.md')
    const open = $('[data-testid="domain-open-questions"]')!
    expect(open.querySelector('h2')?.textContent).toContain('矛盾與未解問題')
    expect([...open.querySelectorAll('button')].map(b => b.textContent)).toEqual(['knowledge/batch', 'knowledge/stream'])
    expect(open.textContent).toContain('兩則對延遲的說法不同')
  })

  it('shows a clear empty state — and invents nothing — for sections the domain does not have', async () => {
    useDomainPage.setState({ domainId: 'soft' })
    render()
    await flush()
    for (const [id, text] of [
      ['domain-overview', '還沒有總覽'], ['domain-core-concepts', '還沒有核心概念'],
      ['domain-key-conclusions', '還沒有重點結論'], ['domain-open-questions', '目前沒有矛盾或未解問題'],
    ] as const) {
      const section = $(`[data-testid="${id}"]`)!
      expect(section.querySelector('[data-slot="empty-state"]')?.textContent, id).toContain(text)
      expect(section.querySelectorAll('li'), id).toHaveLength(0)
    }
    expect($$('[data-testid="domain-note"]').map(note => note.dataset.path)).toEqual(['knowledge/rust.md'])
  })

  it('renders in zh and en with the same structure', async () => {
    useDomainPage.setState({ domainId: 'data' })
    render(en, 'en')
    await flush()
    expect($('[data-testid="domain-core-concepts"] h2')?.textContent).toContain('Core concepts')
    expect($('[data-testid="domain-key-conclusions"] h2')?.textContent).toContain('Key conclusions')
    expect($('[data-testid="domain-open-questions"] h2')?.textContent).toContain('Contradictions and open questions')
    expect($('[data-testid="domain-notes"] h2')?.textContent).toContain('Knowledge notes')
    render(zh, 'zh')
    await flush()
    expect($('[data-testid="domain-core-concepts"] h2')?.textContent).toContain('核心概念')
    expect($('[data-testid="domain-notes"] h2')?.textContent).toContain('知识笔记')
  })
})

describe('整理頁的入口（ALMNC-54.23 AC #1、#3）', () => {
  it('showDomainPage opens the 整理 page on the 領域 tab, straight to a domain when given an id', async () => {
    showDomainPage('data')
    expect(useKnowledgeOverlay.getState()).toMatchObject({ visible: true, tab: 'domains' })
    expect(useDomainPage.getState().domainId).toBe('data')
    render(zhTW, 'zh-TW', KnowledgeScreen)
    await flush()
    expect($('[data-testid="domain-detail"]')?.dataset.domain).toBe('data')
    expect($('h1')?.textContent).toBe('整理')
  })

  it('the 整理 page has a 領域 tab that switches to the domain list and back to the other tabs', async () => {
    useKnowledgeOverlay.setState({ visible: true, tab: 'timeline' })
    render(zhTW, 'zh-TW', KnowledgeScreen)
    await flush()
    expect($('[data-testid="timeline-tab"]')).not.toBeNull()
    const tab = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === '領域')
    expect(tab).toBeTruthy()
    click(tab)
    await flush()
    expect($('[data-testid="domain-list"]')).not.toBeNull()
    expect($('[data-testid="timeline-tab"]')).toBeNull()
  })

  it('classic: the 整理 page and its 領域 tab do not exist and showDomainPage does not open anything', () => {
    useUiModeStore.setState({ mode: 'classic' })
    showDomainPage('data')
    expect(useKnowledgeOverlay.getState().visible).toBe(false)
    render(zhTW, 'zh-TW', KnowledgeScreen)
    expect(container.innerHTML).toBe('')
  })
})
