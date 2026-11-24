// @vitest-environment jsdom
// almanac ALMNC-83.4 驗收 #2：新介面下快速記錄文字存成一筆資料源，出現在資料源清單。
// 走真的模組：主視窗的快速記錄處理（initQuickRecordText）→ addNewSource → @/db/v3-sources（node:sqlite 記憶體資料庫）
// → refreshSources → 工作台 store → 資料源清單（useSourceRows + SourcesTab）；快速記錄視窗（page.tsx）→ requestQuickRecord。
// 只換掉 Tauri 邊界：視窗事件（listen / emitTo 接成同一條假的事件匯流排）、invoke、plugin-store、剪貼簿、
// note.db 的連線（getDb 換成 node:sqlite）、標籤表、舊記錄寫入（classic 對照組看它有沒有被叫）、指揮官佇列與本機模型。
import { createRequire } from 'node:module'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../messages/zh-TW.json'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    all(bindings: Bindings): unknown[]
    run(bindings: Bindings): { changes: number | bigint, lastInsertRowid: number | bigint }
  }
  close(): void
}

const bus = vi.hoisted(() => {
  type Handler = (event: { event: string, payload: unknown }) => void
  const listeners = new Map<string, Set<Handler>>()
  const emitted: Array<{ target: string, event: string, payload: unknown }> = []
  return {
    listeners,
    emitted,
    listen: (event: string, handler: Handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
      return Promise.resolve(() => { listeners.get(event)?.delete(handler) })
    },
    emitTo: (target: string, event: string, payload: unknown) => {
      emitted.push({ target, event, payload })
      for (const handler of [...(listeners.get(event) ?? [])]) handler({ event, payload })
      return Promise.resolve()
    },
  }
})

const fake = vi.hoisted(() => ({
  tags: [{ id: 7, name: 'Inbox', isLocked: false, isPin: false }],
  insertExternalMark: vi.fn(async () => 1),
  kick: vi.fn(async () => ({ analyzed: [], rejected: [], failed: [] })),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  invoke: vi.fn(async (_command: string, _args?: unknown) => undefined as unknown),
  clipboard: '',
}))

const sqlite = vi.hoisted(() => {
  // node:sqlite 用 createRequire 載入（vite 不會去解析 node: 內建模組）。
  return { db: undefined as unknown as SqliteDb }
})
sqlite.db = new (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }).DatabaseSync(':memory:')
const bind = (values: Array<string | number | null> = []) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

vi.mock('@/db/index', () => ({
  executeRecordTransaction: async () => { throw new Error('not used') },
  getDb: async () => ({
    execute: async (sql: string, values?: Array<string | number | null>) => {
      const result = sqlite.db.prepare(sql).run(bind(values))
      return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values?: Array<string | number | null>) => sqlite.db.prepare(sql).all(bind(values)),
  }),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: bus.listen,
    setTitle: async () => undefined,
    onCloseRequested: async () => () => undefined,
  }),
}))
vi.mock('@tauri-apps/api/event', () => ({ emitTo: bus.emitTo, emit: async () => undefined, listen: bus.listen }))
vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: fake.invoke,
  isTauri: () => true,
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class { static getByLabel = async () => null } }))
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: async () => undefined, save: async () => undefined }) },
}))
vi.mock('tauri-plugin-clipboard-api', () => ({ hasText: async () => fake.clipboard !== '', readText: async () => fake.clipboard }))
vi.mock('@/db/tags', () => ({ getTags: async () => fake.tags }))
vi.mock('@/db/marks', async importOriginal => ({ ...(await importOriginal<typeof import('@/db/marks')>()), insertExternalMark: fake.insertExternalMark }))
vi.mock('@/lib/commander/default-deps', () => ({ commanderQueue: async () => ({ kick: fake.kick }) }))
vi.mock('@/lib/local-model/default', () => ({ defaultLocalModel: async () => { throw new Error('ollama off') } }))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // Node 自己的 localStorage（沒給 --localstorage-file 時是 undefined）會蓋掉 jsdom 的；換成記憶體版。
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
  })
})

const { useUiModeStore } = await import('@/lib/fork-ui')
const { default: initQuickRecordText } = await import('./quick-record-text')
const { listSources } = await import('@/db/v3-sources')
const { LEGACY_NOTE_KIND } = await import('@/lib/v3-model/source')
const { default: useWorkbenchStore } = await import('@/stores/workbench')
const { useSourceRows } = await import('@/lib/workbench/use-workbench')
const { SourcesTab } = await import('@/app/core/main/decide/sources-tab')
const { default: QuickRecordPage } = await import('@/app/quick-record/page')

/** 資料源分頁讀的同一個查詢（refreshSources 用的條件）。 */
const sourceListQuery = () => listSources({ limit: 500, excludeKind: LEGACY_NOTE_KIND, includeArchived: true })

let disposeHandler: (() => void) | undefined

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

/** 像快速記錄視窗那樣送一個請求到主視窗，等同一個 id 的回應。 */
async function send(request: Record<string, unknown>) {
  const before = bus.emitted.length
  await bus.emitTo('main', 'quick-record-request', request)
  for (let i = 0; i < 50; i++) {
    const response = bus.emitted.slice(before).find(entry => entry.event === 'quick-record-response' && (entry.payload as { id: string }).id === request.id)
    if (response) return response.payload as Record<string, unknown>
    await settle(1)
  }
  throw new Error(`no response for ${String(request.id)}`)
}

beforeEach(async () => {
  sqlite.db.exec('delete from sources')
  bus.emitted.length = 0
  fake.insertExternalMark.mockClear()
  fake.kick.mockClear()
  fake.invoke.mockClear()
  fake.clipboard = ''
  localStorage.clear()
  vi.spyOn(console, 'debug').mockImplementation(() => undefined)
  useUiModeStore.setState({ mode: 'v3' })
  disposeHandler = await initQuickRecordText()
}, 30000)

afterEach(() => {
  disposeHandler?.()
  vi.restoreAllMocks()
})

// 第一次 beforeEach 前 sources 表還不存在：先建好（initV3SourceDb 是冪等的）。
await (await import('@/db/v3-sources')).initV3SourceDb()

afterAll(() => sqlite.db.close())

describe('主視窗處理快速記錄請求（V3）', () => {
  it('tells the quick-record window to save as a source', async () => {
    const response = await send({ id: 'prep-1', action: 'prepare' })
    expect(response).toMatchObject({ context: { target: 'source' } })
  })

  it('saves typed text as one source that the 資料源 list query returns', async () => {
    const response = await send({ id: 'qr-1', action: 'save', target: 'source', text: '  明天要寄報價單  ', pastedChars: 0 })
    expect(response).toEqual({ id: 'qr-1', saved: true })

    const rows = await sourceListQuery()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'text', content: '明天要寄報價單', collector: 'scott', sourceType: 'self', status: 'pending_analysis' })
    // 自己打的字直接交給指揮官（R2），不走記錄。
    expect(fake.kick).toHaveBeenCalledTimes(1)
    expect(fake.insertExternalMark).not.toHaveBeenCalled()
    // addNewSource 之後 refreshSources 已把它放進工作台 store（資料源分頁讀的地方）。
    expect(useWorkbenchStore.getState().sources.map(source => source.content)).toEqual(['明天要寄報價單'])
  })

  it('does not add a second source when the same request id is resent', async () => {
    await send({ id: 'qr-dup', action: 'save', target: 'source', text: '只要一筆', pastedChars: 0 })
    const again = await send({ id: 'qr-dup', action: 'save', target: 'source', text: '只要一筆', pastedChars: 0 })
    expect(again).toEqual({ id: 'qr-dup', saved: true })
    const rows = await sourceListQuery()
    expect(rows.map(row => row.content)).toEqual(['只要一筆'])
  })

  it('treats mostly pasted text as an external capture awaiting decision', async () => {
    await send({ id: 'qr-paste', action: 'save', target: 'source', text: 'pasted article text', pastedChars: 19 })
    const rows = await sourceListQuery()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ content: 'pasted article text', sourceType: 'external', status: 'awaiting_decision' })
    expect(fake.kick).not.toHaveBeenCalled()
  })

  it('rejects empty text without adding a source', async () => {
    const response = await send({ id: 'qr-empty', action: 'save', target: 'source', text: '   ' })
    expect(response).toEqual({ id: 'qr-empty', error: 'invalid' })
    expect(await sourceListQuery()).toHaveLength(0)
  })

  it('shows the saved text as a row in the 資料源 tab', async () => {
    await send({ id: 'qr-list', action: 'save', target: 'source', text: '快速記錄進資料源清單', pastedChars: 0 })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Element.prototype.scrollIntoView = vi.fn()
    function Tab() {
      return h(SourcesTab, { rows: useSourceRows(), commanderName: '指揮官', onDesk: () => undefined })
    }
    act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(Tab) })))
    const [row] = await sourceListQuery()
    const item = container.querySelector<HTMLElement>(`[data-row="src:${row.id}"]`)
    expect(item).not.toBeNull()
    expect(item!.textContent).toContain('快速記錄進資料源清單')
    act(() => root.unmount())
    container.remove()
  })
})

describe('classic 對照組', () => {
  it('prepares the window for records and saves to the old record path, not as a source', async () => {
    useUiModeStore.setState({ mode: 'classic' })
    // 存好之後的舊版畫面刷新（標籤、記錄、對話 store）在測試環境讀不到資料庫，quick-record-text 會吞掉並記一筆錯誤。
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await send({ id: 'prep-c', action: 'prepare' })).toMatchObject({ context: { target: 'record' } })
    // classic 視窗送出時不帶 target，帶記錄標籤。
    const response = await send({ id: 'qr-classic', action: 'save', text: '舊版記錄', tagId: 7 })
    expect(response).toEqual({ id: 'qr-classic', saved: true })
    expect(fake.insertExternalMark).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'quick-record:qr-classic', tagId: 7, type: 'text', content: '舊版記錄' }))
    expect(await sourceListQuery()).toHaveLength(0)
  })
})

describe('快速記錄視窗（page.tsx）在 V3', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderPage() {
    await act(async () => {
      root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(QuickRecordPage) }))
    })
    await act(async () => { await settle() })
  }

  function type(value: string) {
    const textarea = container.querySelector<HTMLTextAreaElement>('#quick-record-text')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function submitButton() {
    return container.querySelector<HTMLButtonElement>('button[type="submit"]')!
  }

  it('hides the record-tag picker and saves the typed text as a source end to end', async () => {
    await renderPage()
    expect(container.textContent).not.toContain(zhTW.record.capture.saveTarget)
    expect(container.querySelector('#quick-record-text')).not.toBeNull()

    type('視窗打的字')
    expect(submitButton().disabled).toBe(false)
    await act(async () => {
      submitButton().click()
      await settle(20)
    })

    const request = bus.emitted.find(entry => entry.event === 'quick-record-request' && (entry.payload as { action: string }).action === 'save')
    expect(request?.target).toBe('main')
    expect(request?.payload).toMatchObject({ action: 'save', text: '視窗打的字', target: 'source', pastedChars: 0 })
    expect(fake.invoke).toHaveBeenCalledWith('hide_quick_record_window')
    const rows = await sourceListQuery()
    expect(rows.map(row => row.content)).toEqual(['視窗打的字'])
    expect(rows[0].sourceType).toBe('self')
  })

  it('counts auto-read clipboard text as pasted so it is saved as an external capture', async () => {
    fake.clipboard = '剪貼簿上的一段文章'
    await renderPage()
    expect(container.querySelector<HTMLTextAreaElement>('#quick-record-text')!.value).toBe('剪貼簿上的一段文章')
    await act(async () => {
      submitButton().click()
      await settle(20)
    })
    const request = bus.emitted.find(entry => entry.event === 'quick-record-request' && (entry.payload as { action: string }).action === 'save')
    expect(request?.payload).toMatchObject({ target: 'source', pastedChars: Array.from('剪貼簿上的一段文章').length })
    const rows = await sourceListQuery()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ content: '剪貼簿上的一段文章', sourceType: 'external', status: 'awaiting_decision' })
  })

  it('keeps the record-tag picker in classic (control)', async () => {
    useUiModeStore.setState({ mode: 'classic' })
    await renderPage()
    expect(container.textContent).toContain(zhTW.record.capture.saveTarget)
  })
})
