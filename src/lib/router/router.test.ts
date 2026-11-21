// Fork（almanac ALMNC-54.11）：路由器三層——規則（前綴、本名、已有標籤、固定來源、多意圖、偏好語氣）、
// 嵌入模型＋範例句（前兩名平均、softmax 溫度 0.02、門檻 0.7）、問 Scott（低信心、本機模型無法使用）。
import { describe, expect, it, vi } from 'vitest'
import {
  appendPreference, cosine, createRouter, DEFAULT_EXEMPLARS, parsePrefix, pickExpert, pickRoute, preferenceLine, resolvePrefix, routeByRules,
  routeScores, ROUTES, type EmbeddingModel, type Exemplars, type RosterEntry, type Route,
} from './router'

const roster: RosterEntry[] = [
  { id: 'cmd', name: 'Mia', role: 'commander', enabled: true },
  { id: 'sec', name: 'Leo', role: 'secretary', enabled: true },
  { id: 'res', name: 'Nora', role: 'researcher', enabled: true },
  { id: 'ie', name: 'Alex', role: 'expert', domain: '工業工程', enabled: true },
  { id: 'de', name: 'Ivy', role: 'expert', domain: '資料工程', enabled: true },
  { id: 'off', name: 'Old', role: 'expert', domain: '舊領域', enabled: false },
]

describe('第一層：規則（AC#1）', () => {
  it('parses @ prefixes (half- and full-width)', () => {
    expect(parsePrefix('@秘書 明天十點開會')).toEqual({ word: '秘書', rest: '明天十點開會' })
    expect(parsePrefix('＠Mia：整理一下')).toEqual({ word: 'Mia', rest: '整理一下' })
    expect(parsePrefix('寄信給 a@b.com')).toBeNull()
  })

  it('role words decide directly, with the 本名 from the roster', () => {
    expect(routeByRules('@秘書 明天十點跟 Alice 開會', { roster })).toMatchObject({
      route: 'schedule', layer: 'rule', reason: 'prefix', confidence: 1, text: '明天十點跟 Alice 開會', target: { role: 'secretary', agentId: 'sec', name: 'Leo' },
    })
    expect(routeByRules('@指揮官 整理這篇', { roster })).toMatchObject({ route: 'process', target: { agentId: 'cmd' } })
    expect(routeByRules('@專家 OEE 怎麼算', { roster })).toMatchObject({ route: 'query', target: { role: 'expert' } })
    expect(routeByRules('@設定 回答都用繁體中文', { roster })).toMatchObject({ route: 'preference', target: { role: 'settings' } })
    expect(routeByRules('@研究員 查一下這個主題', { roster })).toMatchObject({ route: 'process' })
  })

  it('a 本名 or an expert domain works as a prefix（@Mia、@Leo、@Alex、@工業工程）', () => {
    expect(routeByRules('@Mia 把這篇整理成重點', { roster })).toMatchObject({ route: 'process', target: { agentId: 'cmd', name: 'Mia' }, prefix: 'Mia' })
    expect(routeByRules('@leo 週五下午留兩小時', { roster })).toMatchObject({ route: 'schedule', target: { agentId: 'sec' } })
    expect(routeByRules('@Alex 節拍時間怎麼算', { roster })).toMatchObject({ route: 'query', target: { agentId: 'ie' } })
    expect(routeByRules('@工業工程 有哪些還沒解決的問題', { roster })).toMatchObject({ route: 'query', target: { agentId: 'ie', name: 'Alex' } })
    // 停用的專家不算；對不到的前綴當一般文字，交給下一層
    expect(routeByRules('@舊領域 問題', { roster })).toBeNull()
    expect(routeByRules('@某人 你好', { roster })).toBeNull()
  })

  it('a tagged conversation decides by its tag; an explicit prefix still wins', () => {
    expect(routeByRules('我週四晚上有空嗎', { tag: 'query', roster })).toMatchObject({ route: 'query', reason: 'tagged', layer: 'rule' })
    expect(routeByRules('把這篇整理成重點', { tag: 'schedule' })).toMatchObject({ route: 'schedule', reason: 'tagged' })
    expect(routeByRules('@Mia 整理', { tag: 'query', roster })).toMatchObject({ route: 'process', reason: 'prefix' })
  })

  it('fixed sources（舊筆記批次）go to the commander', () => {
    expect(routeByRules('舊筆記 1,240 則', { fixedSource: 'legacy_batch', roster })).toMatchObject({ route: 'process', reason: 'fixed_source', target: { agentId: 'cmd' } })
  })

  it('AC#4: one sentence with several requests goes to the commander to split', () => {
    for (const text of ['下週二開會，順便整理上次的紀錄', '先排會議然後再寄信', '提醒我交報告，另外再幫我整理筆記']) {
      expect(routeByRules(text, { roster })).toMatchObject({ route: 'process', reason: 'multi_intent', target: { role: 'commander', name: 'Mia' } })
    }
  })

  it('preference markers go to the settings area（照實測的詞）', () => {
    for (const text of ['會議紀錄以後都幫我拆出待辦', '我甜點喜歡吃香草口味', '我不喜歡太長的摘要', '每次都用繁體中文回答', '不要再用粗體', '研究員的調研改成每個月彙整一次']) {
      expect(routeByRules(text)).toMatchObject({ route: 'preference', reason: 'preference_marker' })
    }
    expect(routeByRules('把今天沒做完的任務移到明天')).toBeNull()
  })
})

describe('第二層：嵌入分數與信心值（AC#2）', () => {
  it('cosine and mean of the top two similarities per route', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0)
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1)
    const scores = routeScores([1, 0], {
      schedule: [[1, 0], [1, 1], [0, 1]], // 1, 0.7071, 0 → 前兩名平均 0.8536
      process: [[0, 1]],
      query: [],
      preference: [[-1, 0], [1, 0]],
    })
    expect(scores.schedule).toBeCloseTo((1 + Math.SQRT1_2) / 2)
    expect(scores.process).toBe(0)
    expect(scores.query).toBe(0)
    expect(scores.preference).toBe(0) // (1 + -1) / 2
  })

  it('reproduces the spike numbers（溫度 0.02）', () => {
    // 「明天下午三點跟 Alice 開會，幫我排進行程」：0.9979
    expect(pickRoute({ schedule: 0.6469, process: 0.4396, query: 0.4187, preference: 0.5227 })).toEqual({ route: 'schedule', confidence: expect.closeTo(0.9979, 3) })
    // 「下週一 06:00 提醒我產生側寫」：0.608，低於 0.7 → 問 Scott
    expect(pickRoute({ schedule: 0.5962, process: 0.5102, query: 0.4781, preference: 0.5869 }).confidence).toBeCloseTo(0.608, 3)
    // 「我之前寫過哪些關於深度工作的筆記」：判成處理 0.6426（實測答錯但會問 Scott）
    expect(pickRoute({ schedule: 0.4812, process: 0.6042, query: 0.5917, preference: 0.5245 })).toEqual({ route: 'process', confidence: expect.closeTo(0.6426, 3) })
    // 溫度越高越不確定
    expect(pickRoute({ schedule: 0.6469, process: 0.4396, query: 0.4187, preference: 0.5227 }, 0.05).confidence).toBeLessThan(0.95)
  })
})

/** 每類兩句範例，各自在一個軸上；測試句的向量直接寫好。 */
const EXEMPLARS: Exemplars = {
  schedule: ['排會議', '提醒我'],
  process: ['整理筆記', '拆任務'],
  query: ['我記過什麼', '進度如何'],
  preference: ['摘要短一點', '不要表情符號'],
}
const AXIS: Record<Route, number> = { schedule: 0, process: 1, query: 2, preference: 3 }

function fakeEmbedding(vectors: Record<string, number[]>, available = true): EmbeddingModel & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async (texts: readonly string[]) => texts.map(text => {
    if (vectors[text]) return vectors[text]
    const route = ROUTES.find(r => EXEMPLARS[r].includes(text))
    if (!route) throw new Error(`no vector for ${text}`)
    const v = [0, 0, 0, 0]
    v[AXIS[route]] = 1
    return v
  }))
  return { available: async () => available, embed }
}

describe('三層合起來', () => {
  it('model layer: confident answers route automatically, with the target role', async () => {
    const model = fakeEmbedding({ '明天三點開會': [1, 0.1, 0.1, 0.1] })
    const router = createRouter({ model, exemplars: EXEMPLARS })
    const decision = await router.route('明天三點開會', { roster })
    expect(decision).toMatchObject({ route: 'schedule', layer: 'model', reason: 'model', target: { role: 'secretary', agentId: 'sec' } })
    expect(decision.confidence).toBeGreaterThan(0.99)
    expect(Object.keys(decision.scores!)).toEqual([...ROUTES])
  })

  it('AC#2: the four routes map to 秘書／指揮官／專家／Agent 設定區', async () => {
    const model = fakeEmbedding({ a: [1, 0, 0, 0], b: [0, 1, 0, 0], c: [0, 0, 1, 0], d: [0, 0, 0, 1] })
    const router = createRouter({ model, exemplars: EXEMPLARS })
    const targets = await Promise.all(['a', 'b', 'c', 'd'].map(text => router.route(text, { roster })))
    expect(targets.map(d => [d.route, d.target?.role])).toEqual([['schedule', 'secretary'], ['process', 'commander'], ['query', 'expert'], ['preference', 'settings']])
  })

  it('AC#3: below the threshold → ask Scott, keeping the best guess as a suggestion', async () => {
    // 兩類幾乎一樣近 → softmax 後約 0.5
    const model = fakeEmbedding({ 模稜兩可: [1, 1, 0, 0] })
    const decision = await createRouter({ model, exemplars: EXEMPLARS }).route('模稜兩可', { roster })
    expect(decision).toMatchObject({ route: null, target: null, layer: 'ask', reason: 'low_confidence' })
    expect(decision.confidence).toBeLessThan(0.7)
    expect(['schedule', 'process']).toContain(decision.suggestion)
  })

  it('AC#3: local model unavailable（沒開、壞掉、沒設定）→ ask Scott; rules still work', async () => {
    const offline = createRouter({ model: fakeEmbedding({}, false), exemplars: EXEMPLARS })
    expect(await offline.route('明天三點開會')).toMatchObject({ layer: 'ask', reason: 'model_unavailable', route: null })
    expect(await offline.route('@秘書 明天三點開會', { roster })).toMatchObject({ layer: 'rule', route: 'schedule' })

    const broken: EmbeddingModel = { available: async () => true, embed: async () => { throw new Error('ECONNREFUSED') } }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await createRouter({ model: broken }).route('明天三點開會')).toMatchObject({ layer: 'ask', reason: 'model_unavailable' })
    warn.mockRestore()
    expect(await createRouter().route('明天三點開會')).toMatchObject({ layer: 'ask', reason: 'model_unavailable' })
  })

  it('rules run before the model（多意圖不會被嵌入模型判成日程）', async () => {
    const model = fakeEmbedding({})
    const decision = await createRouter({ model, exemplars: EXEMPLARS }).route('下週二開會，順便整理上次的紀錄', { roster })
    expect(decision).toMatchObject({ route: 'process', layer: 'rule', reason: 'multi_intent' })
    expect(model.embed).not.toHaveBeenCalled()
  })

  it('embeds the exemplars once and reuses them', async () => {
    const model = fakeEmbedding({ x: [1, 0, 0, 0], y: [0, 1, 0, 0] })
    const router = createRouter({ model, exemplars: EXEMPLARS })
    await router.route('x')
    await router.route('y')
    expect(model.embed).toHaveBeenCalledTimes(3) // 範例句一次＋兩句
    expect(model.embed.mock.calls[0][0]).toHaveLength(8)
  })

  it('ships the spike exemplars（每類 5 句）as the default data file', () => {
    for (const route of ROUTES) expect(DEFAULT_EXEMPLARS[route]).toHaveLength(5)
    expect(DEFAULT_EXEMPLARS.preference).toContain('以後摘要都寫短一點')
  })
})

describe('查詢找哪位專家', () => {
  it('picks the expert whose domain or name is mentioned; one expert is obvious; otherwise ask', () => {
    expect(pickExpert('工業工程裡節拍時間怎麼算', roster)).toMatchObject({ kind: 'expert', agent: { id: 'ie' } })
    expect(pickExpert('問 Ivy 資料管線的事', roster)).toMatchObject({ kind: 'expert', agent: { id: 'de' } })
    expect(pickExpert('上次會議決定了什麼', roster)).toMatchObject({ kind: 'ask', candidates: [{ id: 'ie' }, { id: 'de' }] })
    expect(pickExpert('上次會議決定了什麼', roster.filter(a => a.id !== 'de'))).toMatchObject({ kind: 'expert', agent: { id: 'ie' } })
    expect(pickExpert('任何問題', roster.filter(a => a.role !== 'expert'))).toEqual({ kind: 'none' })
    expect(pickExpert('上次會議', roster, 'de')).toMatchObject({ kind: 'expert', agent: { id: 'de' } })
  })
})

describe('偏好', () => {
  it('strips a settings prefix and trailing punctuation; appends without duplicates', () => {
    expect(preferenceLine('@設定 以後回答都用繁體中文。')).toBe('以後回答都用繁體中文')
    expect(preferenceLine('卡片文字不要用粗體字')).toBe('卡片文字不要用粗體字')
    expect(appendPreference('', '卡片文字不要用粗體字')).toBe('- 卡片文字不要用粗體字\n')
    expect(appendPreference('- 回答用繁體中文\n', '摘要三句話')).toBe('- 回答用繁體中文\n- 摘要三句話\n')
    expect(appendPreference('- 摘要三句話\n', '摘要三句話')).toBe('- 摘要三句話\n')
    expect(appendPreference('我是 Scott', '摘要三句話')).toBe('我是 Scott\n- 摘要三句話\n')
  })
})

it('resolvePrefix ignores unknown words', () => {
  expect(resolvePrefix('路人', roster)).toBeNull()
})
