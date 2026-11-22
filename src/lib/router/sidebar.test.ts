// Fork（almanac ALMNC-54.11）：右側欄照路由器的決定做——日程交秘書、處理交指揮官、查詢交專家（只讀）、偏好先確認再存、
// 低信心或本機模型無法使用時問 Scott；選擇會記下來。
import { describe, expect, it, vi } from 'vitest'
import type { RosterEntry, RouteDecision } from './router'
import {
  addRouterChoice, chooseRoute, MAX_ROUTER_CHOICES, planSidebarRoute, routeNote, savePreferenceLine, shouldRouteSidebarMessage, type RouterChoice,
} from './sidebar'

const roster: RosterEntry[] = [
  { id: 'cmd', name: 'Mia', role: 'commander', enabled: true },
  { id: 'sec', name: 'Leo', role: 'secretary', enabled: true },
  { id: 'ie', name: 'Alex', role: 'expert', domain: '工業工程', enabled: true },
  { id: 'de', name: 'Ivy', role: 'expert', domain: '資料工程', enabled: true },
]

function decision(extra: Partial<RouteDecision>): RouteDecision {
  return { route: null, target: null, confidence: 0.9, layer: 'model', reason: 'model', text: '一句話', ...extra }
}

describe('planSidebarRoute', () => {
  it('日程 → 標成日程，照處理模式走（秘書的直接修改）', () => {
    expect(planSidebarRoute(decision({ route: 'schedule' }), roster)).toMatchObject({ kind: 'run', route: 'schedule', tag: 'schedule', readOnly: false })
  })

  it('處理 → 標成處理，交給指揮官', () => {
    expect(planSidebarRoute(decision({ route: 'process', reason: 'multi_intent', layer: 'rule' }), roster)).toMatchObject({ kind: 'run', tag: 'process', readOnly: false })
  })

  it('查詢 → 標成查詢、只讀，看得出領域就交給那位專家；看不出來問 Scott；沒有專家由指揮官只讀回答', () => {
    expect(planSidebarRoute(decision({ route: 'query', text: '工業工程的節拍時間怎麼算' }), roster)).toMatchObject({ kind: 'run', tag: 'query', readOnly: true, answerAs: { id: 'ie' } })
    expect(planSidebarRoute(decision({ route: 'query', text: '上次會議決定了什麼' }), roster)).toMatchObject({ kind: 'askExpert', candidates: [{ id: 'ie' }, { id: 'de' }] })
    const none = planSidebarRoute(decision({ route: 'query' }), roster.filter(agent => agent.role !== 'expert'))
    expect(none).toMatchObject({ kind: 'run', tag: 'query', readOnly: true })
    expect('answerAs' in none && none.answerAs).toBeFalsy()
    // @工業工程 前綴已經指定專家
    expect(planSidebarRoute(decision({ route: 'query', target: { role: 'expert', agentId: 'de' } }), roster)).toMatchObject({ answerAs: { id: 'de' } })
  })

  it('偏好 → 先貼一行確認（不開對話）', () => {
    expect(planSidebarRoute(decision({ route: 'preference', text: '以後摘要都寫短一點。' }), roster)).toEqual(expect.objectContaining({ kind: 'confirmPreference', line: '以後摘要都寫短一點' }))
  })

  it('AC#3: 問 Scott（低信心或本機模型無法使用）', () => {
    expect(planSidebarRoute(decision({ layer: 'ask', reason: 'low_confidence', suggestion: 'query', confidence: 0.55 }), roster)).toMatchObject({ kind: 'askRoute' })
    expect(planSidebarRoute(decision({ layer: 'ask', reason: 'model_unavailable', confidence: 0 }), roster)).toMatchObject({ kind: 'askRoute' })
  })

  it('Scott 選了去處 → 照選的走（信心 1）；選專家時直接指定', () => {
    const asked = decision({ layer: 'ask', reason: 'low_confidence', text: '上次會議決定了什麼' })
    expect(chooseRoute(asked, 'schedule', roster)).toMatchObject({ kind: 'run', tag: 'schedule', decision: { route: 'schedule', confidence: 1, layer: 'ask' } })
    expect(chooseRoute(asked, 'query', roster)).toMatchObject({ kind: 'askExpert' })
    expect(chooseRoute(asked, 'query', roster, 'de')).toMatchObject({ kind: 'run', answerAs: { id: 'de' } })
    expect(chooseRoute(asked, 'preference', roster)).toMatchObject({ kind: 'confirmPreference' })
  })
})

describe('shouldRouteSidebarMessage', () => {
  const base = { v3: true, readOnlyMode: false, streaming: false, hasMessages: false, explicitTag: null, text: '明天開會', forced: false }
  it('only new, untagged conversations in 處理 mode', () => {
    expect(shouldRouteSidebarMessage(base)).toBe(true)
    expect(shouldRouteSidebarMessage({ ...base, explicitTag: 'query' })).toBe(false) // 已有標籤 → 照標籤（規則層）
    expect(shouldRouteSidebarMessage({ ...base, hasMessages: true })).toBe(false)
    expect(shouldRouteSidebarMessage({ ...base, readOnlyMode: true })).toBe(false)
    expect(shouldRouteSidebarMessage({ ...base, streaming: true })).toBe(false)
    expect(shouldRouteSidebarMessage({ ...base, forced: true })).toBe(false)
    expect(shouldRouteSidebarMessage({ ...base, v3: false })).toBe(false)
    expect(shouldRouteSidebarMessage({ ...base, text: '  ' })).toBe(false)
  })
})

describe('偏好存進 Agent 設定區', () => {
  it('appends to Scott\'s preferences after confirmation, skipping duplicates', async () => {
    let content = '- 回答用繁體中文\n'
    const store = { get: vi.fn(async () => content), save: vi.fn(async (next: string) => { content = next }) }
    expect(await savePreferenceLine('卡片文字不要用粗體字', store)).toBe(true)
    expect(content).toBe('- 回答用繁體中文\n- 卡片文字不要用粗體字\n')
    expect(await savePreferenceLine('卡片文字不要用粗體字', store)).toBe(false)
    expect(store.save).toHaveBeenCalledTimes(1)
  })
})

describe('routeNote', () => {
  it('tells the run who it is for', () => {
    expect(routeNote({ kind: 'run', route: 'schedule', tag: 'schedule', readOnly: false, decision: decision({ route: 'schedule' }) })).toContain('schedule_add_task')
    expect(routeNote({ kind: 'run', route: 'query', tag: 'query', readOnly: true, answerAs: roster[2], decision: decision({ route: 'query' }) })).toContain('"Alex" (domain: 工業工程)')
    expect(routeNote({ kind: 'run', route: 'process', tag: 'process', readOnly: false, decision: decision({ route: 'process', reason: 'multi_intent' }) })).toContain('split it')
    expect(routeNote({ kind: 'run', route: 'process', tag: 'process', readOnly: false, decision: decision({ route: 'process' }) })).toBe('')
  })
})

describe('router choices（之後補範例句、校準）', () => {
  it('keeps the latest 200', () => {
    const choice: RouterChoice = { text: 'x', chosen: 'query', suggestion: 'process', confidence: 0.6, reason: 'low_confidence', at: 0 }
    let list: RouterChoice[] = []
    for (let i = 0; i < MAX_ROUTER_CHOICES + 5; i++) list = addRouterChoice(list, { ...choice, at: i })
    expect(list).toHaveLength(MAX_ROUTER_CHOICES)
    expect(list[0].at).toBe(5)
  })
})
