// @vitest-environment jsdom
// Fork（almanac ALMNC-65.2）：工作台的批次卡——同一資料源的新知識筆記合成一張，整批接受（逐則寫入、失敗不擋其他、日誌標籤只貼一次）、
// 逐則退回不影響其他則、改標題沿用既有欄位、只有一則時照原本的單卡。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

const mocks = vi.hoisted(() => ({
  acceptUndo: vi.fn(async () => true),
  acceptDecision: vi.fn(),
  rejectDecision: vi.fn<(item: { ref: { itemId: string, proposalId: string } }) => Promise<void>>(async () => {}),
  setSourceJournal: vi.fn(async () => {}),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
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

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: vi.fn(), save: vi.fn() }) },
}))
vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ conversations: [], currentConversationId: null, chats: [], startNewConversation: vi.fn(), switchConversation: vi.fn(async () => {}) })) }
})
vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ workspacePath: '', language: 'zh-TW' })) }
})
vi.mock('@/db/agents', () => ({ listAgentSettings: async () => [{ id: 'a1', name: 'Mia', role: 'commander', enabled: true }], ensureDefaultRoster: async () => false }))
vi.mock('@/db/agent-memory', () => ({ appendActivity: vi.fn(async () => {}) }))
vi.mock('@/db/v3-domains', () => ({ listDomains: async () => [] }))
vi.mock('@/db/v3-sources', () => ({ setSourceJournal: mocks.setSourceJournal }))
vi.mock('@/lib/collect/ai', () => ({ askCollectModel: async () => null }))
vi.mock('@/lib/proposals/actions', () => ({ discussProposal: vi.fn(), openConversation: vi.fn() }))
vi.mock('@/lib/decide/actions', () => ({
  refreshJournal: vi.fn(async () => {}), acceptDecision: mocks.acceptDecision, rejectDecision: mocks.rejectDecision,
  DraftNotApplied: class extends Error {},
}))
vi.mock('@/lib/workbench/actions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/workbench/actions')>(),
  refreshSources: vi.fn(async () => {}),
}))
vi.mock('../jobs/job-result', () => ({ JobReviewPreview: () => null }))

const useCollectStore = (await import('@/stores/collect')).default
const useDecideStore = (await import('@/stores/decide')).default
const useInboxStore = (await import('@/stores/inbox')).default
const useWorkbenchStore = (await import('@/stores/workbench')).default
const useVaultIndexStore = (await import('@/stores/vault-index')).default
const useSettingStore = (await import('@/stores/setting')).default
const useDailySettingsStore = (await import('@/stores/daily-settings')).default
const { EMPTY_LEGACY } = await import('@/stores/workbench')
const { DecideScreen } = await import('./decide-screen')

let container: HTMLDivElement
let root: Root
const DAY = 86_400_000
const NOW = Date.now()

const knowledge = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: 'note' as const, title: `知識 ${id}`, body: `${id} 的內文`, due: '', time: '', tags: [], status: 'wait' as const,
  sourceIds: ['S-1'], noteType: 'knowledge' as const, drafter: { role: 'expert' as const }, ...extra,
})

function setItems(journal = false) {
  const tag = journal ? { journalTag: { confidence: 'high' as const, reason: '流水帳' } } : {}
  useCollectStore.setState({
    hydrate: vi.fn(async () => {}),
    visible: false,
    items: [
      { id: 'src1', input: { kind: 'text', text: '', name: '產線檢討會議' }, createdAt: NOW - 2 * DAY, state: 'ready', proposals: [
        knowledge('a', tag), knowledge('b', tag), knowledge('c', tag),
        knowledge('t', { kind: 'task', title: '寄報價單', noteType: undefined, ...tag }),
      ] },
      { id: 'src2', input: { kind: 'text', text: '', name: '另一則資料源' }, createdAt: NOW - DAY, state: 'ready', proposals: [knowledge('solo', { sourceIds: ['S-2'] })] },
    ],
  })
}

function render() {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages, timeZone: 'Asia/Taipei', children: h(DecideScreen) })))
}
const $$ = (selector: string, scope: ParentNode = container) => [...scope.querySelectorAll<HTMLElement>(selector)]
const titles = () => $$('[data-testid="review-card"] [data-testid="card-title"]').map(el => el.textContent)
const batchCard = () => container.querySelector<HTMLElement>('[data-testid="review-card"][data-card^="batch:"]')
const rows = () => $$('[data-testid="batch-item"]')
const rowTitles = () => $$('[data-testid="batch-item-title"]').map(el => el.textContent)
const row = (key: string) => container.querySelector<HTMLElement>(`[data-testid="batch-item"][data-item="${key}"]`)!
const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
const expand = () => act(() => batchCard()!.querySelector<HTMLButtonElement>('[data-card-toggle]')!.click())
function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const statusOf = (proposalId: string) => useCollectStore.getState().items.flatMap(item => item.proposals).find(p => p.id === proposalId)?.status

beforeEach(async () => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  Element.prototype.scrollIntoView = vi.fn()
  useUiModeStore.setState({ mode: 'v3' })
  mocks.acceptDecision.mockImplementation(async (item: { ref: { itemId: string, proposalId: string } }) => {
    useCollectStore.setState(state => ({ items: state.items.map(entry => entry.id !== item.ref.itemId ? entry : { ...entry, proposals: entry.proposals.map(p => p.id === item.ref.proposalId ? { ...p, status: 'ok' as const } : p) }) }))
    return { path: `Inbox/${item.ref.proposalId}.md`, undo: mocks.acceptUndo }
  })
  mocks.rejectDecision.mockImplementation(async (item: { ref: { itemId: string, proposalId: string } }) => {
    useCollectStore.getState().reject(item.ref.itemId, item.ref.proposalId)
  })
  setItems()
  useDailySettingsStore.setState({ inboxFolder: 'Inbox', initSettings: vi.fn(async () => {}) } as never)
  useInboxStore.setState({ visible: false, records: [], processed: new Map(), refresh: vi.fn(async () => {}) })
  useWorkbenchStore.setState({
    tab: 'review', filter: 'all', cursor: null, expanded: null, leaving: [], aside: {}, showAside: false, history: [], dismissed: [],
    sourceFilter: { status: 'pending', journal: false }, picked: new Set(), selectedRow: null, editing: false, edited: new Set(),
    sources: [], outputCounts: new Map(), sourcesError: false, desk: { open: false, materials: [] },
    hydrateAside: vi.fn(async () => {}),
    legacy: EMPTY_LEGACY,
  })
  useVaultIndexStore.setState({ notes: new Map(), revision: 0 })
  useSettingStore.setState({ workbenchSingleKeys: true })
  useDecideStore.setState({ visible: true, selected: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  render()
  await wait(10)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('同一資料源的新知識筆記批次卡（ALMNC-65.2）', () => {
  it('AC#1: notes from one source show as one batch card listing each (title, folder); other kinds and single notes stay as normal cards', () => {
    expect(titles()).toEqual(['知識 a等 2 則', '寄報價單', '知識 solo'])
    expect(batchCard()!.querySelector('[data-testid="card-kind"]')!.textContent).toBe('筆記新增')
    expect(container.querySelector('[data-testid="review-card"][data-card="collect:src2:solo"]')).not.toBeNull()
    expand()
    expect(rows()).toHaveLength(3)
    expect(rowTitles()).toEqual(['知識 a', '知識 b', '知識 c'])
    expect($$('[data-testid="batch-item-folder"]').map(el => el.textContent)).toEqual(['Inbox', 'Inbox', 'Inbox'])
    const panel = batchCard()!.querySelector('[data-testid="card-panel"]')!
    expect($$('[data-action]', panel).map(b => b.textContent)).toEqual(['全部接受A', '先放著S'])
    // 展開一則看內容、改標題（沿用新增筆記的欄位）
    act(() => row('collect:src1:b').querySelector<HTMLButtonElement>('[data-testid="batch-item-toggle"]')!.click())
    const detail = row('collect:src1:b').querySelector('[data-testid="batch-item-detail"]')!
    expect(detail.textContent).toContain('b 的內文')
    const input = detail.querySelector<HTMLInputElement>('[data-testid="new-note-title"]')!
    type(input, '知識 b（改）')
    act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(useCollectStore.getState().items[0]!.proposals.find(p => p.id === 'b')!.title).toBe('知識 b（改）')
    expect(rowTitles()).toEqual(['知識 a', '知識 b（改）', '知識 c'])
  })

  it('AC#2: accept all writes each note, one failure does not stop the others, and reports the result', async () => {
    const accept = mocks.acceptDecision.getMockImplementation()!
    mocks.acceptDecision.mockImplementation(async (item: { ref: { proposalId: string } }, options?: unknown) => {
      if (item.ref.proposalId === 'b') throw new Error('disk full')
      return accept(item, options)
    })
    expand()
    await act(async () => batchCard()!.querySelector<HTMLButtonElement>('button[data-action="accept"]')!.click())
    await wait(260)
    expect(mocks.acceptDecision.mock.calls.map(call => (call[0] as { key: string }).key)).toEqual(['collect:src1:a', 'collect:src1:b', 'collect:src1:c'])
    expect(mocks.acceptDecision.mock.calls.every(call => (call[1] as { journalTag?: boolean })?.journalTag === false)).toBe(true)
    expect([statusOf('a'), statusOf('b'), statusOf('c')]).toEqual(['ok', 'wait', 'ok'])
    expect(mocks.toast).toHaveBeenCalledWith('已接受 2 則新筆記', expect.objectContaining({ action: expect.objectContaining({ label: '復原 Z' }) }))
    expect(mocks.toast.error).toHaveBeenCalledWith('1 則沒有接受成功：「知識 b」，其他則已接受')
    // 剩一則：變回原本的單卡
    expect(batchCard()).toBeNull()
    expect(titles()).toEqual(['知識 b', '寄報價單', '知識 solo'])
  })

  it('AC#2: sending one back does not affect the others; accepting one from the batch works alone', async () => {
    expand()
    await act(async () => row('collect:src1:b').querySelector<HTMLButtonElement>('[data-batch-action="drop"]')!.click())
    await wait(260)
    expect(mocks.rejectDecision).toHaveBeenCalledTimes(1)
    expect(mocks.rejectDecision).toHaveBeenCalledWith(expect.objectContaining({ key: 'collect:src1:b' }))
    expect([statusOf('a'), statusOf('b'), statusOf('c')]).toEqual(['wait', 'no', 'wait'])
    expect(mocks.toast).toHaveBeenCalledWith('已放棄「知識 b」', expect.anything())
    expect(rowTitles()).toEqual(['知識 a', '知識 c'])
    await act(async () => batchCard()!.querySelector<HTMLButtonElement>('button[data-action="accept"]')!.click())
    await wait(260)
    expect(mocks.acceptDecision.mock.calls.map(call => (call[0] as { key: string }).key)).toEqual(['collect:src1:a', 'collect:src1:c'])
    expect([statusOf('a'), statusOf('b'), statusOf('c')]).toEqual(['ok', 'no', 'ok'])
    expect(titles()).toEqual(['寄報價單', '知識 solo'])
  })

  it('accept all tags the source as a journal only once (ALMNC-69.3 rule)', async () => {
    setItems(true)
    await wait(0)
    expand()
    expect(batchCard()!.querySelector('[data-testid="card-journal-verdict"]')).not.toBeNull()
    await act(async () => batchCard()!.querySelector<HTMLButtonElement>('button[data-action="accept"]')!.click())
    await wait(260)
    expect(mocks.acceptDecision).toHaveBeenCalledTimes(3)
    expect(mocks.setSourceJournal).toHaveBeenCalledTimes(1)
    expect(mocks.setSourceJournal).toHaveBeenCalledWith('S-1', true)
  })
})

it('keeps a weekly MOC as one 整理 card and lets Scott accept or return each change', async () => {
  const id = 'M-20261112-060012-VPB3'
  const mocReview = { id, week: '2026-W48', name: '時間管理' }
  const itemId = `cleanup:moc:${id}:2026-W48`
  const edit = (text: string) => ({ path: '領域.md', baseContent: '# 時間管理', content: `# 時間管理\n${text}`, summary: text })
  act(() => useCollectStore.setState({
    items: [{
      id: itemId, input: { kind: 'text', text: '', name: '清理提案' }, createdAt: NOW, state: 'ready', proposals: [
        { ...knowledge('conclusion'), title: '重點結論', body: '先排重要的事', edits: [edit('先排重要的事')], mocReview },
        { ...knowledge('open'), title: '待釐清', body: '還有什麼例子？', edits: [edit('還有什麼例子？')], mocReview },
      ],
    }],
  }))
  expect(titles()).toEqual(['時間管理'])
  expect(batchCard()!.querySelector('[data-testid="card-kind"]')!.textContent).toBe('知識整理')
  expand()
  expect(rowTitles()).toEqual(['重點結論', '待釐清'])
  expect(batchCard()!.querySelector('[data-action="accept"]')).toBeNull()
  expect(row(`collect:${itemId}:conclusion`).textContent).toContain('先排重要的事')
  act(() => row(`collect:${itemId}:conclusion`).querySelector<HTMLButtonElement>('[data-batch-action="accept"]')!.click())
  await wait(230)
  expect(statusOf('conclusion')).toBe('ok')
  expect(titles()).toEqual(['時間管理'])
  expect(rowTitles()).toEqual(['待釐清'])
  act(() => row(`collect:${itemId}:open`).querySelector<HTMLButtonElement>('[data-batch-action="drop"]')!.click())
  await wait(230)
  expect(statusOf('open')).toBe('no')
  expect(titles()).toEqual([])
})
