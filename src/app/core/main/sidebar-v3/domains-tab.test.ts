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
  readNote: vi.fn<(path: string) => Promise<string | null>>(async () => null),
  toast: vi.fn(),
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
vi.mock('@/lib/daily/note-io', () => ({ revealInFileTree: mocks.revealInFileTree, readNote: mocks.readNote }))
vi.mock('sonner', () => ({ toast: mocks.toast }))
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
const useMocStore = (await import('@/stores/moc')).default
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
  // Fork（almanac ALMNC-69.7）：這組測試是沒有 MOC 檔的舊領域（退回 frontmatter 反查與領域表總覽）；MOC 當資料來源另有測試。
  useMocStore.setState({ mocs: [], overLimit: [], loaded: true })
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
    // 舊領域沒有章節：成員都在「尚未分章」。
    expect($('[data-testid="domain-chapter"]')?.dataset.unsorted).toBe('true')
    expect(container.textContent).not.toContain('站會')
    await act(async () => { $('[data-path="knowledge/idempotent.md"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(mocks.revealInFileTree).toHaveBeenCalledWith('knowledge/idempotent.md')
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('knowledge/idempotent.md')
  })

  it('goes back to the list, and moves to the parent domain from the header', async () => {
    render()
    await flush()
    click($('[data-domain="data"]'))
    const parent = $('[data-testid="domain-header-parent"]')!
    expect(parent.textContent).toContain('工程')
    click(parent.querySelector<HTMLElement>('[data-domain="eng"]'))
    expect($('h2')?.textContent).toBe('工程')
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

describe('還沒有 MOC 檔的舊領域：領域表總覽換成五區塊（ALMNC-54.23 AC #2 → ALMNC-69.8）', () => {
  it('shows the overview as ①, key conclusions as ④ and contradictions as ⑤, with source notes as links that open the note', async () => {
    useDomainPage.setState({ domainId: 'data' })
    render()
    await flush()
    expect($('[data-testid="domain-position"]')?.textContent).toContain('資料從來源到分析的整條管線。')
    const conclusions = $('[data-testid="domain-conclusions"]')!
    expect(conclusions.querySelector('h2')?.textContent).toContain('重點結論')
    expect(conclusions.textContent).toContain('先確保冪等再談效能')
    const source = conclusions.querySelector('button')!
    expect(source.textContent).toBe('knowledge/idempotent')
    await act(async () => { source.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('knowledge/idempotent.md')
    const open = $('[data-testid="domain-open"]')!
    expect(open.querySelector('h2')?.textContent).toContain('待釐清')
    expect([...open.querySelectorAll('button')].map(b => b.textContent)).toEqual(['knowledge/batch', 'knowledge/stream'])
    expect(open.textContent).toContain('兩則對延遲的說法不同')
    expect(open.textContent).toContain('未標來源')
    // 核心概念不在五區塊裡；從這裡開始只給 MOC。
    expect(container.textContent).not.toContain('核心概念')
    expect($('[data-testid="domain-start"]')).toBeNull()
  })

  it('always shows ① and ③ (with empty states) and hides ④ ⑤ when there is nothing — inventing nothing', async () => {
    useDomainPage.setState({ domainId: 'ie' })
    render()
    await flush()
    expect($('[data-testid="domain-position"] [data-slot="empty-state"]')?.textContent).toContain('還沒有定位問題')
    expect($('[data-testid="domain-chapters"] [data-slot="empty-state"]')?.textContent).toContain('還沒有章節')
    expect($('[data-testid="domain-conclusions"]')).toBeNull()
    expect($('[data-testid="domain-open"]')).toBeNull()
  })

  it('renders in zh and en with the same structure', async () => {
    useDomainPage.setState({ domainId: 'data' })
    render(en, 'en')
    await flush()
    expect($('[data-testid="domain-position"] h2')?.textContent).toContain('Positioning question')
    expect($('[data-testid="domain-chapters"] h2')?.textContent).toContain('Chapters')
    expect($('[data-testid="domain-conclusions"] h2')?.textContent).toContain('Key conclusions')
    expect($('[data-testid="domain-open"] h2')?.textContent).toContain('Open questions')
    render(zh, 'zh')
    await flush()
    expect($('[data-testid="domain-position"] h2')?.textContent).toContain('定位问题')
    expect($('[data-testid="domain-open"] h2')?.textContent).toContain('待厘清')
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

describe('領域頁的資料來源是 MOC 檔（ALMNC-69.7）', () => {
  it('lists the MOC formal entries (in MOC order, ignoring frontmatter domains) and takes the sections from the five blocks', async () => {
    const { parseMoc } = await import('@/lib/moc/parse')
    const moc = parseMoc([
      '---', 'id: M-20261120-000000-DATA', 'kind: domain', 'level: 2', '---', '# 資料工程', '',
      '## ① 這個領域在回答什麼', '資料怎麼可靠地流到分析端？', '',
      '## ③ 章節', '', '### 怎麼重跑', '<!-- C-20261120-000001-RERN -->', '- [[stream]] ── 延遲取捨', '- [[idempotent]] ── 先求冪等', '',
      '## ④ 重點結論', '- 先確保冪等（[[knowledge/idempotent]]）', '',
      '## ⑤ 待釐清', '- **未解**：批次還是串流？', '',
    ].join('\n'), '20 領域/資料工程.md')
    act(() => useMocStore.setState({ mocs: [moc], loaded: true }))
    render()
    await flush()
    click($('[data-domain="data"]'))
    // batch 的 frontmatter 列了資料工程，但 MOC 沒收錄 → 不算；順序照 MOC。
    expect($$('[data-testid="domain-note"]').map(note => note.dataset.path)).toEqual(['knowledge/stream.md', 'knowledge/idempotent.md'])
    expect($('[data-testid="domain-position"]')?.textContent).toContain('資料怎麼可靠地流到分析端？')
    expect($('[data-testid="domain-conclusions"]')?.textContent).toContain('先確保冪等')
    expect($('[data-testid="domain-open"]')?.textContent).toContain('批次還是串流？')
  })

  it('shows loading until the MOCs have been parsed once', async () => {
    act(() => useMocStore.setState({ mocs: [], loaded: false }))
    render()
    await flush()
    expect($('[role="status"]')?.textContent).toBeTruthy()
    expect($$('[data-testid="domain-row"]')).toEqual([])
  })
})

describe('MOC 頁五區塊（ALMNC-69.8 AC #1）', () => {
  const SIX = ['idempotent', 'batch', 'stream', 'rust', 'a', 'b']
  const mocRaw = (opts: { members?: string[], start?: boolean, conclusions?: boolean, open?: boolean, status?: string, unsorted?: string[] } = {}) => {
    const members = opts.members ?? ['stream', 'idempotent']
    return [
      '---', 'id: M-20261120-000000-DATA', 'kind: domain', 'level: 2', ...(opts.status ? [`status: ${opts.status}`] : []), '---', '# 資料工程', '',
      '上層：[[工程]]　　相關：[[軟體工程]]、資料治理（還沒建立）　　相鄰：串流系統、資料品質', '',
      '## ① 這個領域在回答什麼', '資料怎麼可靠地流到分析端？', '',
      ...(opts.start ? ['## ② 從這裡開始', '1. [[knowledge/idempotent]]', ''] : []),
      '## ③ 章節', '',
      '### 怎麼重跑', '<!-- C-20261120-000001-RERN -->', ...members.map(m => `- [[${m}]] ── 關於 ${m}`), '',
      '### 怎麼監控', '<!-- C-20261120-000002-MONI -->', '',
      '### 尚未分章', '<!-- C-20261120-000003-UNSO -->', ...(opts.unsorted ?? []), '',
      ...(opts.conclusions ? ['## ④ 重點結論', '- 先確保冪等（[[knowledge/idempotent]]）', ''] : []),
      ...(opts.open ? ['## ⑤ 待釐清', '- **矛盾**：[[batch]] ⟷ [[stream]]（來源：筆記之間）', '- **知識缺口**：監控還沒有筆記（來源：專家）', '- **未解**：要不要即時？', ''] : []),
    ].join('\n')
  }
  const seedMoc = async (raw: string) => {
    const { parseMoc } = await import('@/lib/moc/parse')
    act(() => useMocStore.setState({ mocs: [parseMoc(raw, '20 領域/資料工程.md')], loaded: true }))
  }
  const seedSix = () => {
    const notes = new Map(useVaultIndexStore.getState().notes)
    for (const name of ['a', 'b']) notes.set(`knowledge/${name}.md`, indexed(`knowledge/${name}.md`, { type: 'knowledge', title: name.toUpperCase() }))
    act(() => useVaultIndexStore.setState({ notes }))
  }

  it('shows ① and ③ always; ② ④ ⑤ only when the MOC has them', async () => {
    await seedMoc(mocRaw())
    useDomainPage.setState({ domainId: 'data' })
    render()
    await flush()
    expect($('[data-testid="domain-position"]')?.textContent).toContain('資料怎麼可靠地流到分析端？')
    expect($('[data-testid="domain-chapters"]')).not.toBeNull()
    expect($('[data-testid="domain-start"]')).toBeNull()
    expect($('[data-testid="domain-conclusions"]')).toBeNull()
    expect($('[data-testid="domain-open"]')).toBeNull()
  })

  it('③ groups notes by chapter with their relation, opens a note on click, hides an empty 尚未分章 and marks empty chapters', async () => {
    await seedMoc(mocRaw())
    useDomainPage.setState({ domainId: 'data' })
    render()
    await flush()
    const chapters = $$('[data-testid="domain-chapter"]')
    expect(chapters.map(chapter => chapter.dataset.chapter)).toEqual(['C-20261120-000001-RERN', 'C-20261120-000002-MONI'])
    const rows = [...chapters[0].querySelectorAll<HTMLElement>('[data-testid="domain-note"]')]
    expect(rows.map(row => row.dataset.path)).toEqual(['knowledge/stream.md', 'knowledge/idempotent.md'])
    expect(rows[1].textContent).toContain('冪等寫入')
    expect(rows[1].querySelector('[data-testid="domain-note-relation"]')?.textContent).toBe('關於 idempotent')
    await act(async () => { rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith('knowledge/stream.md')
    expect(chapters[1].querySelector('[data-testid="domain-chapter-empty"]')?.textContent).toBe('還沒有筆記')
  })

  it('尚未分章 comes last when it has notes; an exploring MOC marks empty chapters as a knowledge gap', async () => {
    await seedMoc(mocRaw({ status: '探索中', unsorted: ['- [[rust]]'] }))
    useDomainPage.setState({ domainId: 'data' })
    render()
    await flush()
    expect($('[data-testid="domain-exploring"]')?.textContent).toBe('探索中')
    const chapters = $$('[data-testid="domain-chapter"]')
    expect(chapters.at(-1)?.dataset.unsorted).toBe('true')
    expect(chapters.at(-1)?.textContent).toContain('尚未分章')
    expect(chapters.at(-1)?.textContent).toContain('所有權')
    expect(chapters[1].querySelector('[data-testid="domain-chapter-gap"]')?.textContent).toBe('知識缺口：還沒有筆記')
  })

  it('② appears once 6 notes are formally included (not at 5)', async () => {
    seedSix()
    await seedMoc(mocRaw({ start: true, members: SIX.slice(0, 5) }))
    useDomainPage.setState({ domainId: 'data' })
    render()
    await flush()
    expect($('[data-testid="domain-start"]')).toBeNull()
    await seedMoc(mocRaw({ start: true, members: SIX }))
    await flush()
    const start = $('[data-testid="domain-start"]')!
    expect(start.querySelector('h2')?.textContent).toContain('從這裡開始')
    expect(start.querySelector('ol')?.textContent).toContain('knowledge/idempotent')
  })

  it('④ lists the conclusions and ⑤ groups 矛盾／未解／知識缺口, each with its source', async () => {
    await seedMoc(mocRaw({ conclusions: true, open: true }))
    useDomainPage.setState({ domainId: 'data' })
    render()
    await flush()
    expect($('[data-testid="domain-conclusions"]')?.textContent).toContain('先確保冪等')
    const groups = $$('[data-testid="domain-open-group"]')
    expect(groups.map(group => group.dataset.kind)).toEqual(['contradiction', 'unresolved', 'gap'])
    expect(groups[0].querySelector('h3')?.textContent).toContain('矛盾')
    expect(groups[0].querySelector('[data-testid="domain-open-source"]')?.textContent).toBe('來源：筆記之間')
    expect(groups[1].querySelector('[data-testid="domain-open-source"]')?.textContent).toBe('未標來源')
    expect(groups[2].textContent).toContain('監控還沒有筆記')
  })

  it('the header shows 上層／相關／相鄰 from the MOC file; known domains are links; 探索 says it is coming soon until 69.13 handles it', async () => {
    await seedMoc(mocRaw())
    useDomainPage.setState({ domainId: 'data' })
    render()
    await flush()
    expect($('[data-testid="domain-header-parent"]')?.textContent).toContain('工程')
    const related = $('[data-testid="domain-header-related"]')!
    expect(related.textContent).toContain('資料治理（還沒建立）')
    expect($('[data-testid="domain-header-adjacent"]')?.textContent).toContain('串流系統')
    click($('[data-testid="domain-explore"]'))
    expect(mocks.toast).toHaveBeenCalledWith('探索功能即將推出')
    const { setExploreHandler } = await import('@/lib/domain-page/explore')
    const handler = vi.fn()
    const off = setExploreHandler(handler)
    click($('[data-testid="domain-explore"]'))
    expect(handler).toHaveBeenCalledWith({ origin: 'adjacent', domainId: 'data', domainName: '資料工程', topics: ['串流系統', '資料品質'] })
    off()
    click(related.querySelector<HTMLElement>('[data-domain="soft"]'))
    expect($('h2')?.textContent).toBe('工程 › 軟體工程')
  })
})

describe('整理 > 領域：未歸屬清單（ALMNC-69.8 AC #1）', () => {
  const seedUnassigned = () => {
    const notes = new Map(useVaultIndexStore.getState().notes)
    notes.set('knowledge/pomodoro.md', indexed('knowledge/pomodoro.md', { type: 'knowledge', title: '番茄鐘', summary: '25 分鐘一輪' }))
    notes.set('knowledge/sleep.md', indexed('knowledge/sleep.md', { type: 'knowledge', title: '睡眠債' }))
    act(() => useVaultIndexStore.setState({ notes }))
    mocks.readNote.mockImplementation(async (path: string) => (path === 'knowledge/sleep.md' ? '---\ntitle: 睡眠債\n---\n欠下的睡眠會累積成 debt。' : '---\n---\n'))
  }
  const type = (input: HTMLInputElement, value: string) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('lists knowledge notes no domain includes (MOC formal entries or legacy frontmatter)', async () => {
    seedUnassigned()
    render()
    await flush()
    const list = $('[data-testid="domain-unassigned"]')!
    expect(list.querySelector('h2')?.textContent).toContain('未歸屬')
    expect($$('[data-testid="unassigned-note"]').map(row => row.dataset.path).sort()).toEqual(['knowledge/pomodoro.md', 'knowledge/sleep.md'])
    expect(list.textContent).not.toContain('冪等寫入')
    expect(list.textContent).not.toContain('站會')
  })

  it('searches titles, summaries and note text', async () => {
    seedUnassigned()
    render()
    await flush()
    const input = $('[data-testid="unassigned-search"]') as HTMLInputElement
    type(input, '25 分鐘')
    await flush()
    expect($$('[data-testid="unassigned-note"]').map(row => row.dataset.path)).toEqual(['knowledge/pomodoro.md'])
    type(input, 'debt')
    await flush()
    expect(mocks.readNote).toHaveBeenCalledWith('knowledge/sleep.md')
    expect($$('[data-testid="unassigned-note"]').map(row => row.dataset.path)).toEqual(['knowledge/sleep.md'])
    type(input, '不存在的字')
    await flush()
    expect($('[data-testid="domain-unassigned"] [data-slot="empty-state"]')?.textContent).toContain('不存在的字')
  })

  it('selects several notes and hands them to 新增領域 (coming soon until 69.13)', async () => {
    seedUnassigned()
    render()
    await flush()
    const create = $('[data-testid="unassigned-create"]') as HTMLButtonElement
    expect(create.disabled).toBe(true)
    for (const row of $$('[data-testid="unassigned-note"]')) click(row.querySelector<HTMLElement>('input[type="checkbox"]'))
    expect($('[data-testid="unassigned-selected"]')?.textContent).toBe('已選 2 則')
    expect(create.disabled).toBe(false)
    click(create)
    expect(mocks.toast).toHaveBeenCalledWith('探索功能即將推出')
    const { setExploreHandler } = await import('@/lib/domain-page/explore')
    const handler = vi.fn()
    const off = setExploreHandler(handler)
    click(create)
    off()
    expect(handler).toHaveBeenCalledWith({ origin: 'unassigned', notePaths: expect.arrayContaining(['knowledge/pomodoro.md', 'knowledge/sleep.md']) })
  })

  it('整理頁的＋新領域會啟動探索提案', async () => {
    const { setExploreHandler } = await import('@/lib/domain-page/explore')
    const handler = vi.fn()
    const off = setExploreHandler(handler)
    try {
      render()
      await flush()
      click($('[data-testid="domain-new"]'))
      expect(handler).toHaveBeenCalledWith({ origin: 'new-domain', topic: '' })
    } finally {
      off()
    }
  })

  it('shows an empty state when every knowledge note is in a domain', async () => {
    render()
    await flush()
    expect($('[data-testid="domain-unassigned"] [data-slot="empty-state"]')?.textContent).toContain('沒有未歸屬的知識筆記')
  })
})
