// @vitest-environment jsdom
// Fork（almanac ALMNC-54.5 → ALMNC-54.8）：工作台（v14）——審核分頁的分組、篩選、就地決定與復原、先放著，
// 資料源分頁的狀態篩選、勾選、交給指揮官、整頁編輯器，檯面三欄，以及舊收集入口與 N／T 快捷鍵。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'
import { createSource, type Source } from '@/lib/v3-model/source'

const mocks = vi.hoisted(() => ({
  discussProposal: vi.fn(async () => 7),
  openConversation: vi.fn(async () => {}),
  acceptUndo: vi.fn(async () => true),
  acceptDecision: vi.fn(),
  rejectDecision: vi.fn(async () => {}),
  handToCommander: vi.fn(async (rows: unknown[]) => ({ count: rows.length, reorganise: 0 })),
  saveSourceEdit: vi.fn(async () => ({ rowId: 'src:d2', version: 2, versioned: true })),
  startProcessConversation: vi.fn(async () => 42),
  processSource: vi.fn(async () => {}),
  startNewConversation: vi.fn(async () => {}),
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
  return { default: create(() => ({ conversations: [], currentConversationId: null, chats: [], startNewConversation: mocks.startNewConversation, switchConversation: vi.fn(async () => {}) })) }
})
vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ workspacePath: '', language: 'zh-TW' })) }
})
vi.mock('@/db/agents', () => ({ listAgentSettings: async () => [{ id: 'a1', name: 'Mia', role: 'commander', enabled: true }], ensureDefaultRoster: async () => false }))
vi.mock('@/db/v3-domains', () => ({ listDomains: async () => [] }))
vi.mock('@/lib/collect/ai', () => ({ askCollectModel: async () => null }))
vi.mock('@/lib/proposals/actions', () => ({ discussProposal: mocks.discussProposal, openConversation: mocks.openConversation }))
vi.mock('@/lib/decide/actions', () => ({
  refreshJournal: vi.fn(async () => {}), acceptDecision: mocks.acceptDecision, rejectDecision: mocks.rejectDecision,
  DraftNotApplied: class extends Error {},
}))
vi.mock('@/lib/workbench/actions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/workbench/actions')>(),
  refreshSources: vi.fn(async () => {}),
  handToCommander: mocks.handToCommander,
  saveSourceEdit: mocks.saveSourceEdit,
  startProcessConversation: mocks.startProcessConversation,
  processSource: mocks.processSource,
}))
vi.mock('../jobs/job-result', () => ({ JobReviewPreview: () => null }))

const emitter = (await import('@/lib/emitter')).default
const useChatStore = (await import('@/stores/chat')).default
const useCollectStore = (await import('@/stores/collect')).default
const useDecideStore = (await import('@/stores/decide')).default
const useInboxStore = (await import('@/stores/inbox')).default
const useThreadsStore = (await import('@/stores/threads')).default
const useWorkbenchStore = (await import('@/stores/workbench')).default
const { DecideScreen } = await import('./decide-screen')

let container: HTMLDivElement
let root: Root
const DAY = 86_400_000
const NOW = Date.now()

const proposal = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: 'note' as const, title: `提案 ${id}`, body: '內文', due: '', time: '', tags: [], status: 'wait' as const, ...extra })

function source(id: string, status: Source['status'], content: string, at = NOW - 3600_000): Source {
  return { ...createSource({ id, sourceType: 'external', kind: 'link', content, origin: `https://example.com/${id}`, collector: 'scott' }, at), status }
}

function render() {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages, timeZone: 'Asia/Taipei', children: h(DecideScreen) })))
}
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T & HTMLElement>(selector)
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)]
const button = (label: string, scope: ParentNode = container) => [...scope.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
const titles = () => $$('[data-testid="review-card"] [data-testid="card-title"]').map(el => el.textContent)
const card = (title: string) => $$('[data-testid="review-card"]').find(el => el.querySelector('[data-testid="card-title"]')?.textContent === title)!
const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  Element.prototype.scrollIntoView = vi.fn()
  useUiModeStore.setState({ mode: 'v3' })
  mocks.acceptDecision.mockImplementation(async (item: { ref: { itemId: string, proposalId: string } }) => {
    useCollectStore.setState(state => ({ items: state.items.map(entry => entry.id !== item.ref.itemId ? entry : { ...entry, proposals: entry.proposals.map(p => p.id === item.ref.proposalId ? { ...p, status: 'ok' as const } : p) }) }))
    return { undo: mocks.acceptUndo }
  })
  useCollectStore.setState({
    hydrate: vi.fn(async () => {}),
    visible: false,
    items: [
      { id: 'old', input: { kind: 'text', text: '舊資料源' }, createdAt: NOW - 3 * DAY, state: 'ready', proposals: [proposal('a', { conversationId: 7 })] },
      { id: 'new', input: { kind: 'text', text: '新資料源' }, createdAt: NOW - 3600_000, state: 'ready', proposals: [proposal('b'), proposal('t', { kind: 'task', title: '確認第三站換模時間' })] },
    ],
  })
  useInboxStore.setState({ visible: false, records: [], processed: new Map(), refresh: vi.fn(async () => {}) })
  useChatStore.setState({ conversations: [{ id: 7, syncId: 's7', syncUpdatedAt: 0, title: '11/19 會議紀錄整理', createdAt: 1, updatedAt: 1, messageCount: 4, isPinned: false }] } as never)
  useWorkbenchStore.setState({
    tab: 'review', filter: 'all', cursor: null, expanded: null, leaving: [], aside: {}, showAside: false, history: [], dismissed: [],
    sourceFilter: 'all', picked: new Set(), selectedRow: null, editing: false, edited: new Set(),
    sources: [source('w', 'awaiting_decision', '白板照片\n第三站 → SMED'), source('d', 'analyzed', '七大浪費\n過量生產、等待')],
    outputCounts: new Map([['d', 2]]), desk: { open: false, materials: [] },
    hydrateAside: vi.fn(async () => {}),
  })
  useDecideStore.setState({ visible: true, selected: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  render()
  // 角色名單（指揮官本名 Mia）是非同步讀進來的
  await wait(10)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('審核 tab', () => {
  it('shows the two tabs with counts and the 先放著 entry at the top right', () => {
    const tabs = $$('[data-testid="workbench-tabs"] [role="tab"]')
    expect(tabs.map(tab => tab.textContent)).toEqual(['審核4', '資料源1'])
    expect($('[data-testid="aside-entry"]')!.textContent).toBe('先放著 0 件')
    expect($('[data-testid="review-keys"]')!.textContent).toContain('復原')
  })

  it('AC#3: one list grouped 提案 (old first); 資料源 cards sit with proposals', () => {
    expect($$('[data-testid="review-group"]').map(el => el.textContent)).toEqual(['提案4'])
    expect(titles()).toEqual(['提案 a', '提案 b', '確認第三站換模時間', '白板照片'])
  })

  it('AC#1: filters 全部／日程／筆記／知識／資料源／回顧 with counts', () => {
    const pills = $$('[data-testid="review-filters"] button').map(b => b.textContent)
    expect(pills).toEqual(['全部4', '日程1', '筆記2', '知識0', '資料源1', '回顧0'])
    act(() => $<HTMLButtonElement>('[data-filter="schedule"]')!.click())
    expect(titles()).toEqual(['確認第三站換模時間'])
    act(() => $<HTMLButtonElement>('[data-filter="knowledge"]')!.click())
    expect($('[data-testid="review-empty"]')!.textContent).toContain('「知識」都處理完了')
  })

  it('AC#2: type is shown as designed text (label + verb), no icons', () => {
    const kind = card('提案 a').querySelector('[data-testid="card-kind"]')!
    expect(kind.textContent).toBe('筆記新增')
    expect(kind.querySelector('svg')).toBeNull()
    expect(card('白板照片').querySelector('[data-testid="card-kind"]')!.textContent).toBe('資料源判斷')
  })

  it('AC#2: decides in place — expand, buttons by card type, collapse when done, Z undoes', async () => {
    act(() => (card('提案 a').firstElementChild as HTMLElement).click())
    const panel = card('提案 a').querySelector('[data-testid="card-panel"]')!
    expect([...panel.querySelectorAll('[data-action]')].map(b => b.textContent)).toEqual(['接受A', '再次討論D', '放棄X', '先放著S'])
    act(() => (card('白板照片').firstElementChild as HTMLElement).click())
    // ALMNC-54.10：沒有初步判斷（本機模型無法使用）時卡片照樣出現，「照建議處理」改成「處理」。
    expect([...card('白板照片').querySelectorAll('[data-action]')].map(b => b.textContent)).toEqual(['處理A', '自己處理', '不採用X', '先放著S'])
    act(() => (card('提案 a').firstElementChild as HTMLElement).click())
    act(() => button('接受A', card('提案 a'))!.click())
    await wait(260)
    expect(mocks.acceptDecision).toHaveBeenCalledWith(expect.objectContaining({ key: 'collect:old:a' }))
    expect(titles()).not.toContain('提案 a')
    expect(mocks.toast).toHaveBeenCalledWith('已接受「提案 a」', expect.objectContaining({ action: expect.objectContaining({ label: '復原 Z' }) }))
    press('z')
    await wait(0)
    expect(mocks.acceptUndo).toHaveBeenCalled()
  })

  it('AC#2: 再次討論 needs a note and returns to the source conversation; the source conversation link opens it', async () => {
    act(() => (card('提案 a').firstElementChild as HTMLElement).click())
    const link = $('[data-testid="card-source-conversation"]')!
    expect(link.textContent).toBe('來自對話：11/19 會議紀錄整理')
    act(() => link.click())
    expect(mocks.openConversation).toHaveBeenCalledWith(7)
    act(() => button('再次討論D')!.click())
    type(container.querySelector('textarea')!, '日期改到下週')
    await act(async () => button(messages.decide.discuss.send)!.click())
    expect(mocks.discussProposal).toHaveBeenCalledWith({ key: 'collect:old:a', conversationId: 7 }, '日期改到下週', expect.any(Function))
  })

  it('AC#4: any card can be put aside with a reminder date; shows 先放著 N 件 and can be taken back', () => {
    act(() => (card('提案 b').firstElementChild as HTMLElement).click())
    act(() => button('先放著S', card('提案 b'))!.click())
    act(() => button('明天', $('[data-testid="put-aside-chooser"]')!)!.click())
    expect(titles()).not.toContain('提案 b')
    expect($('[data-testid="aside-entry"]')!.textContent).toBe('先放著 1 件')
    expect(useWorkbenchStore.getState().aside['collect:new:b'].until).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    act(() => $<HTMLButtonElement>('[data-testid="aside-entry"]')!.click())
    const row = $('[data-testid="aside-row"]')!
    expect(row.textContent).toContain('提案 b')
    expect(row.textContent).toMatch(/\d{4}-\d{2}-\d{2} 提醒/)
    act(() => button('拿回來', row)!.click())
    act(() => $<HTMLButtonElement>('[data-testid="aside-entry"]')!.click())
    expect(titles()).toContain('提案 b')
  })

  it('keyboard: ↓ moves the selection, S puts the current card aside without a date, Z brings it back', async () => {
    expect(card('提案 a').getAttribute('aria-selected')).toBe('true')
    press('ArrowDown')
    expect(card('提案 b').getAttribute('aria-selected')).toBe('true')
    press('s')
    expect(titles()).not.toContain('提案 b')
    expect(useWorkbenchStore.getState().aside['collect:new:b'].until).toBeUndefined()
    press('z')
    await wait(0)
    expect(titles()).toContain('提案 b')
  })

  it('AC#5: 自己處理 opens the desk with 素材／工作稿／協助 and starts a 處理 conversation', async () => {
    act(() => (card('白板照片').firstElementChild as HTMLElement).click())
    act(() => button('自己處理', card('白板照片'))!.click())
    await wait(0)
    expect($('[data-testid="desk"]')).not.toBeNull()
    expect($('[data-testid="desk-materials"] h2')!.textContent).toBe('素材 · 1 則')
    expect($('[data-testid="desk-draft"] h2')!.textContent).toBe('工作稿')
    expect($('[data-testid="desk-help"] h2')!.textContent).toBe('協助')
    expect(mocks.startProcessConversation).toHaveBeenCalledTimes(1)
    expect(useWorkbenchStore.getState().desk.conversationId).toBe(42)
    expect([...$$('[data-desk-op]')].map(el => el.textContent)).toEqual([])
    expect($('[data-testid="desk-material"]')!.textContent).toContain(messages.workbench.desk.notesOnly)
    act(() => $<HTMLButtonElement>('[data-testid="desk-back"]')!.click())
    expect($('[data-testid="desk"]')).toBeNull()
    expect(titles()).toContain('白板照片')
  })
})

describe('資料源 tab', () => {
  beforeEach(() => {
    useInboxStore.setState({ records: [{ id: 5, tagId: 1, type: 'text', content: '第三站換模可以試 SMED', desc: '', url: '', deleted: 0, createdAt: NOW - 2 * DAY }] })
    act(() => $<HTMLButtonElement>('[data-tab="sources"]')!.click())
  })

  it('has only a status filter (no input box or search), permanent checkboxes and 「N / M 已整理」', () => {
    expect($$('[data-testid="source-filters"] button').map(b => b.textContent)).toEqual(['全部5', '等你決定1', '未整理1', '已整理3', '不採用0'])
    expect(container.querySelector('[data-testid="sources-tab"] input')).toBeNull()
    expect($$('[data-testid="source-row"] [role="checkbox"]')).toHaveLength(5)
    // 舊收集頁丟進來、已拆成提案的項目算已整理（產出在審核）。
    expect($('[data-testid="organised-summary"]')!.textContent).toBe('3 / 5 已整理')
    act(() => $<HTMLButtonElement>('[data-filter="done"]')!.click())
    expect($$('[data-testid="source-row"]').map(row => row.dataset.row)).toEqual(['src:d', 'cap:new', 'cap:old'])
    const row = $('[data-row="src:d"]')!
    expect(row.querySelector('[data-testid="row-done"]')).not.toBeNull()
    expect(row.querySelector('[data-testid="row-sub"]')!.textContent).toBe('2 則產出')
  })

  it('select all → 交給 Mia 整理 hands the picked rows to the commander', async () => {
    await wait(0)
    act(() => $<HTMLButtonElement>('[data-filter="wait"]')!.click())
    act(() => $<HTMLButtonElement>('[aria-label="全選目前清單"]')!.click())
    expect($('[data-testid="source-multi"]')!.textContent).toContain('已選 1 則')
    const hand = $<HTMLButtonElement>('[data-testid="hand-to-commander"]')!
    expect(hand.textContent).toBe('交給 Mia 整理')
    await act(async () => hand.click())
    expect(mocks.handToCommander).toHaveBeenCalledWith([expect.objectContaining({ id: 'src:w', status: 'wait' })])
    expect(mocks.toast).toHaveBeenCalledWith('已交給 Mia 整理 1 則，產出會送到審核')
  })

  it('攤到檯面 from the selection opens the desk with those materials', async () => {
    act(() => $<HTMLButtonElement>('[data-row="rec:5"] [role="checkbox"]')!.click())
    act(() => button('攤到檯面', $('[data-testid="source-multi"]')!)!.click())
    await wait(0)
    expect($('[data-testid="desk-material"]')!.textContent).toContain('第三站換模可以試 SMED')
  })

  it('E opens the full-page editor; saving an organised source stores a new version', async () => {
    act(() => $<HTMLElement>('[data-row="src:d"]')!.click())
    expect($('[data-testid="source-detail"]')!.textContent).toContain('重新整理')
    press('e')
    expect($('[data-testid="editor-heading"]')!.textContent).toBe('正在編輯 · 新版本 v2')
    expect($('[role="toolbar"]')!.textContent).toContain('粗體')
    expect($('[data-testid="editor-words"]')!.textContent).toBe('11 字')
    type(container.querySelector<HTMLTextAreaElement>('[data-testid="source-editor"] textarea')!, '過量生產、等待、搬運')
    await act(async () => $<HTMLButtonElement>('[data-testid="editor-save"]')!.click())
    expect(mocks.saveSourceEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'src:d' }), '七大浪費\n\n過量生產、等待、搬運')
    expect(mocks.toast).toHaveBeenCalledWith('已存成 v2，送給 Mia 才會更新產出')
  })

  it('an edited, not-yet-sent version offers 送給 Mia 更新', () => {
    act(() => useWorkbenchStore.setState(state => ({ sources: [...state.sources, { ...source('d2', 'pending_analysis', '七大浪費\n改過'), version: 2, previousId: 'd' }], edited: new Set(['d2']) })))
    act(() => $<HTMLElement>('[data-row="src:d2"]')!.click())
    expect($('[data-row="src:d2"] [data-testid="row-sub"]')!.textContent).toBe('v2 未送出')
    expect(button('送給 Mia 更新')).toBeDefined()
  })

  it('A on an awaiting source runs 照建議處理', async () => {
    act(() => $<HTMLElement>('[data-row="src:w"]')!.click())
    press('a')
    await wait(0)
    expect(mocks.processSource).toHaveBeenCalledWith('w')
  })
})

describe('routing and global keys', () => {
  it('legacy collect / inbox entries open the 資料源 tab', async () => {
    act(() => useDecideStore.getState().hide())
    act(() => useCollectStore.getState().show())
    await wait(0)
    expect(useDecideStore.getState().visible).toBe(true)
    expect(useCollectStore.getState().visible).toBe(false)
    expect(useWorkbenchStore.getState().tab).toBe('sources')
    act(() => useWorkbenchStore.getState().setTab('review'))
    act(() => useInboxStore.getState().show({ focusMarkId: 9 }))
    await wait(0)
    expect(useWorkbenchStore.getState().tab).toBe('sources')
    expect(useWorkbenchStore.getState().selectedRow).toBe('rec:9')
  })

  it('N opens 新增資料源 and T starts a new conversation (not while typing)', async () => {
    const opened = vi.fn()
    emitter.on('unified-record-open', opened)
    press('n')
    expect(opened).toHaveBeenCalledWith({ target: 'source' })
    press('t')
    await wait(0)
    expect(useThreadsStore.getState().visible).toBe(true)
    expect(mocks.startNewConversation).toHaveBeenCalled()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true })) })
    expect(opened).toHaveBeenCalledTimes(1)
    input.remove()
    emitter.off('unified-record-open', opened)
  })
})
