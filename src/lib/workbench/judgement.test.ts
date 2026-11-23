// Fork（almanac ALMNC-54.10）：外部擷取資料源的初步判斷（R1）與新增資料源時的分流（R1／R2）。
import { describe, expect, it, vi } from 'vitest'
import { createSource, type Source } from '@/lib/v3-model/source'
import {
  buildJudgementPrompt, ingestSource, judgementHint, judgementLine, judgeSource, JUDGEMENT_SUGGESTIONS, newSourceType, parseJudgement,
  type JudgeModel, type SourceJudgement,
} from './judgement'

const NOW = Date.parse('2026-11-21T10:00:00')

function source(extra: Partial<Source> = {}): Source {
  return { ...createSource({ id: 's1', sourceType: 'external', kind: 'text', content: '11/19 產線檢討會議紀錄…', collector: 'scott' }, NOW), ...extra }
}

function model(answer: string | Error, available = true): JudgeModel & { generate: ReturnType<typeof vi.fn> } {
  return {
    config: { judgeModel: 'qwen3.5:2b' },
    available: async () => available,
    generate: vi.fn(async () => {
      if (answer instanceof Error) throw answer
      return answer
    }),
  }
}

describe('parseJudgement', () => {
  it('reads「類型｜建議」and keeps only known suggestions', () => {
    expect(parseJudgement('研究報告｜存成知識筆記')).toEqual({ type: '研究報告', suggestion: '存成知識筆記' })
    expect(parseJudgement('類型：會議紀錄｜建議：存成紀錄筆記＋拆出任務')).toEqual({ type: '會議紀錄', suggestion: '存成紀錄筆記＋拆出任務' })
    expect(parseJudgement('讀書筆記｜無待辦任務')).toEqual({ type: '讀書筆記' }) // 建議不可靠：對不到選項就不顯示
    expect(parseJudgement('專案計畫')).toEqual({ type: '專案計畫' })
  })

  it('drops 不採用 when the model also suggests keeping it', () => {
    expect(parseJudgement('零碎想法｜知識筆記或不採用')).toEqual({ type: '零碎想法', suggestion: '存成知識筆記' })
  })

  it('returns null when there is no usable type（照抄格式、在撰寫）', () => {
    expect(parseJudgement('類型｜建議採用')).toBeNull()
    expect(parseJudgement('這是一份關於產線平衡與節拍時間的詳細研究筆記｜存成知識筆記')).toBeNull()
    expect(parseJudgement('不採用')).toBeNull()
    expect(parseJudgement('')).toBeNull()
  })
})

describe('buildJudgementPrompt', () => {
  it('lists every suggestion option, asks for one line, and never asks for a draft', () => {
    const prompt = buildJudgementPrompt('x'.repeat(5000))
    for (const option of JUDGEMENT_SUGGESTIONS) expect(prompt).toContain(option)
    expect(prompt).toContain('只判斷、不撰寫')
    expect(prompt).toContain('只輸出一行')
    expect(prompt.length).toBeLessThan(3400) // 只取前 3000 字
  })
})

describe('judgeSource', () => {
  it('AC#1: stores a one-line judgement（類型｜建議）from the local model', async () => {
    const saved: SourceJudgement[] = []
    const m = model('會議紀錄｜存成紀錄筆記＋拆出任務')
    const result = await judgeSource(source(), { model: m, save: async j => { saved.push(j) }, now: () => NOW })
    expect(result).toMatchObject({ sourceId: 's1', status: 'ready', type: '會議紀錄', suggestion: '存成紀錄筆記＋拆出任務', model: 'qwen3.5:2b', followSuggestion: false })
    expect(saved).toEqual([result])
    expect(judgementLine(result)).toBe('會議紀錄｜存成紀錄筆記＋拆出任務')
    expect(m.generate.mock.calls[0][1]).toEqual({ maxTokens: 40 })
  })

  it('AC#4: no local model → saved as unavailable, card line stays empty, nothing throws', async () => {
    const saved: SourceJudgement[] = []
    const save = async (j: SourceJudgement) => { saved.push(j) }
    const offline = await judgeSource(source(), { model: model('x', false), save })
    const crashed = await judgeSource(source(), { model: model(new Error('ECONNREFUSED')), save })
    const none = await judgeSource(source(), { save })
    for (const result of [offline, crashed, none]) {
      expect(result.status).toBe('unavailable')
      expect(judgementLine(result)).toBe('')
    }
    expect(saved).toHaveLength(3)
  })

  it('unparseable answers count as no judgement', async () => {
    const result = await judgeSource(source(), { model: model('類型｜建議採用'), save: async () => undefined })
    expect(result).toMatchObject({ status: 'unavailable', error: 'unparseable' })
  })

  it('links: fetches the page first; a failed capture is stored as capture_failed（重試／刪除）', async () => {
    const link = source({ kind: 'link', content: 'https://example.com/a', origin: 'https://example.com/a' })
    const m = model('研究報告｜存成知識筆記')
    const fetchPage = vi.fn(async () => '# 標題\n內文')
    const ok = await judgeSource(link, { model: m, fetchPage, save: async () => undefined })
    expect(fetchPage).toHaveBeenCalledWith('https://example.com/a')
    expect(m.generate.mock.calls[0][0]).toContain('內文')
    expect(ok.status).toBe('ready')

    const failed = await judgeSource(link, { model: m, fetchPage: async () => { throw new Error('403 blocked') }, save: async () => undefined })
    expect(failed).toMatchObject({ status: 'capture_failed', error: '403 blocked' })
    const empty = await judgeSource(link, { model: m, fetchPage: async () => '  ', save: async () => undefined })
    expect(empty.status).toBe('capture_failed')
  })

  it('does not send images or files to the text model', async () => {
    const m = model('x')
    const result = await judgeSource(source({ kind: 'image', content: 'data:image/png;base64,AAA' }), { model: m, save: async () => undefined })
    expect(result.status).toBe('unavailable')
    expect(m.generate).not.toHaveBeenCalled()
  })

  it('ALMNC-57: Email, RSS posts and meeting transcripts are judged from their stored text（no page fetch）', async () => {
    for (const kind of ['email', 'rss', 'meeting']) {
      const m = model('會議紀錄｜拆出任務')
      const fetchPage = vi.fn(async () => 'page')
      const result = await judgeSource(source({ kind, content: '週會\n\nScott Chen：好，那就這樣決定。', origin: 'https://x.example/a' }), { model: m, fetchPage, save: async () => undefined })
      expect(result).toMatchObject({ status: 'ready', type: '會議紀錄' })
      expect(m.generate).toHaveBeenCalledTimes(1)
      expect(fetchPage).not.toHaveBeenCalled()
    }
  })

  it('a retry keeps the creation time and the 照建議處理 flag', async () => {
    const previous: SourceJudgement = { sourceId: 's1', status: 'capture_failed', followSuggestion: true, createdAt: NOW - 1000, updatedAt: NOW - 1000 }
    const result = await judgeSource(source(), { model: model('日誌'), previous, save: async () => undefined, now: () => NOW })
    expect(result).toMatchObject({ status: 'ready', type: '日誌', followSuggestion: true, createdAt: NOW - 1000, updatedAt: NOW })
  })

  it('a save failure does not break the card', async () => {
    const result = await judgeSource(source(), { model: model('日誌'), save: async () => { throw new Error('db locked') } })
    expect(result.status).toBe('ready')
  })
})

describe('judgementHint（照建議處理 → 給指揮官的提示）', () => {
  it('only when Scott chose 照建議處理', () => {
    const base: SourceJudgement = { sourceId: 's1', status: 'ready', type: '會議紀錄', suggestion: '拆出任務', followSuggestion: false, createdAt: 0, updatedAt: 0 }
    expect(judgementHint(base)).toBeUndefined()
    expect(judgementHint({ ...base, followSuggestion: true })).toBe('會議紀錄｜拆出任務')
    expect(judgementHint(undefined)).toBeUndefined()
  })
})

describe('ingestSource（新增資料源時的分流）', () => {
  function deps(created: Source) {
    return { add: vi.fn(async () => created), kick: vi.fn(async () => undefined), judge: vi.fn(async () => undefined) }
  }

  it('R1: external → 等你決定, judged in the background, not handed to the commander', async () => {
    const created = source()
    const d = deps(created)
    expect((await ingestSource({}, d)).status).toBe('awaiting_decision')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(d.judge).toHaveBeenCalledWith(created)
    expect(d.kick).not.toHaveBeenCalled()
  })

  it('AC#3 / R2: self-written and system sources go straight to the commander', async () => {
    for (const sourceType of ['self', 'system'] as const) {
      const created = createSource({ id: `s-${sourceType}`, sourceType, kind: 'text', content: '隨手記', collector: 'scott' }, NOW)
      const d = deps(created)
      const result = await ingestSource({}, d)
      expect(result.status).toBe('pending_analysis')
      expect(d.kick).toHaveBeenCalledTimes(1)
      expect(d.judge).not.toHaveBeenCalled()
    }
  })

  it('AC#4: a failing judgement never fails the new source', async () => {
    const d = { ...deps(source()), judge: vi.fn(async () => { throw new Error('ollama down') }) }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(ingestSource({}, d)).resolves.toMatchObject({ id: 's1' })
    await new Promise(resolve => setTimeout(resolve, 0))
    warn.mockRestore()
  })
})

describe('newSourceType（ALMNC-69.3 這是日誌）', () => {
  it('勾了「這是日誌」的文字算自己寫的，即使是貼上的；連結照舊是外部擷取', () => {
    expect(newSourceType({ type: 'text', content: '貼上的一大段', pastedChars: 100 })).toBe('external')
    expect(newSourceType({ type: 'text', content: '貼上的一大段', pastedChars: 100, journal: true })).toBe('self')
    expect(newSourceType({ type: 'link', content: 'https://a.b', journal: true })).toBe('external')
  })
})

describe('newSourceType', () => {
  it('links and mostly-pasted text are external; typed text, todos and prompt drafts are self-written', () => {
    expect(newSourceType({ type: 'link', content: 'https://a.b' })).toBe('external')
    expect(newSourceType({ type: 'text', content: '一大段貼上的文章內容', pastedChars: 10 })).toBe('external')
    expect(newSourceType({ type: 'text', content: '自己打的一句話', pastedChars: 0 })).toBe('self')
    expect(newSourceType({ type: 'text', content: '自己打了很多字只貼了一點點', pastedChars: 2 })).toBe('self')
    expect(newSourceType({ type: 'todo', content: '買牛奶', pastedChars: 3 })).toBe('self')
    expect(newSourceType({ type: 'prompt-draft', content: 'x', pastedChars: 1 })).toBe('self')
  })
})
