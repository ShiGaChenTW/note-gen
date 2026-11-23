import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFragmentPrompt, dropLogFragments, fallbackFragment, MAX_FRAGMENTS, parseFragments, parseJournalVerdict, splitAndClassify, splitSource } from './split'

const TODAY = new Date(2026, 10, 21, 9, 0, 0)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('parseFragments', () => {
  it('一則資料源拆成多個片段，各自判斷並補上日期、相關的人、所屬專案', () => {
    const raw = JSON.stringify({ fragments: [
      { kind: 'event', title: '和 Amy 開會', date: '2026-11-25', time: '10:00', people: ['Amy'], project: '新官網' },
      { kind: 'task', title: '寄報價單', date: '2026-11-22', people: ['Ben'] },
      { kind: 'note', noteType: 'knowledge', title: '產線平衡要先算節拍時間', body: '節拍時間＝可用時間÷需求量', domainHint: '工業工程' },
      { kind: 'note', noteType: 'record', title: '11/20 客戶拜訪', body: '…', date: '2026-11-20' },
      { kind: 'reject', title: '電子報廣告', reason: '廣告' },
    ] })
    const fragments = parseFragments(raw)
    expect(fragments.map(f => f.kind)).toEqual(['event', 'task', 'note', 'note', 'reject'])
    expect(fragments.map(f => f.index)).toEqual([0, 1, 2, 3, 4])
    expect(fragments[0]).toMatchObject({ date: '2026-11-25', time: '10:00', people: ['Amy'], project: '新官網' })
    expect(fragments[1]).toMatchObject({ date: '2026-11-22', people: ['Ben'] })
    expect(fragments[1].time).toBeUndefined()
    expect(fragments[2]).toMatchObject({ noteType: 'knowledge', domainHint: '工業工程' })
    expect(fragments[3]).toMatchObject({ noteType: 'record', date: '2026-11-20' })
    expect(fragments[4]).toMatchObject({ reason: '廣告' })
  })

  it('行程缺時間降成任務；日期格式不對就清掉；kind 不認得就跳過', () => {
    const fragments = parseFragments(JSON.stringify({ fragments: [
      { kind: 'event', title: '找時間吃飯', date: '2026-11-30' },
      { kind: 'task', title: '交報告', date: '2026/11/30' },
      { kind: 'memo', title: '???' },
    ] }))
    expect(fragments).toHaveLength(2)
    expect(fragments[0]).toMatchObject({ kind: 'task', date: '2026-11-30' })
    expect(fragments[1].date).toBeUndefined()
  })

  it('筆記沒說類型：有專案 → 專案筆記；有日期 → 紀錄筆記；否則知識筆記', () => {
    const fragments = parseFragments(JSON.stringify([
      { kind: 'note', title: 'A', project: '搬家' },
      { kind: 'note', title: 'B', date: '2026-11-01' },
      { kind: 'note', title: 'C' },
    ]))
    expect(fragments.map(f => f.noteType)).toEqual(['project', 'record', 'knowledge'])
  })

  it('沒標題就用內文第一行；接受程式碼框與 <think>', () => {
    const raw = '<think>想一下</think>```json\n{"fragments":[{"kind":"note","noteType":"knowledge","body":"# 一個想法\\n內文"}]}\n```'
    expect(parseFragments(raw)[0].title).toBe('一個想法')
  })

  it(`最多 ${MAX_FRAGMENTS} 個片段`, () => {
    const many = Array.from({ length: MAX_FRAGMENTS + 3 }, (_, i) => ({ kind: 'task', title: `t${i}` }))
    expect(parseFragments(JSON.stringify(many))).toHaveLength(MAX_FRAGMENTS)
  })

  it('壞掉的輸出回傳空陣列', () => {
    expect(parseFragments('抱歉，我無法處理')).toEqual([])
    expect(parseFragments('{"fragments": [')).toEqual([])
  })
})

describe('splitAndClassify', () => {
  it('模型輸出壞掉時退回一個保底片段，整則原文都在', async () => {
    const text = '第一行\n第二行很重要\n第三行'
    const fragments = await splitAndClassify(text, async () => 'not json', { today: TODAY })
    expect(fragments).toHaveLength(1)
    expect(fragments[0]).toMatchObject({ kind: 'note', noteType: 'record', title: '第一行', body: text, fallback: true })
  })

  it('模型丟錯或回傳空清單也退回保底片段', async () => {
    const thrown = await splitAndClassify('內容', async () => { throw new Error('offline') }, { today: TODAY })
    expect(thrown[0]).toMatchObject({ fallback: true, body: '內容' })
    const empty = await splitAndClassify('內容', async () => '{"fragments":[]}', { today: TODAY })
    expect(empty[0]).toMatchObject({ fallback: true, body: '內容' })
  })

  it('改過的新版本：提示裡附上一版，只拆差異', async () => {
    const ask = vi.fn<(prompt: string) => Promise<string>>(async () => '[{"kind":"task","title":"新增的事"}]')
    await splitAndClassify('新版內容', ask, { today: TODAY, previousText: '舊版內容' })
    const prompt = ask.mock.calls[0][0]
    expect(prompt).toContain('舊版內容')
    expect(prompt).toContain('只拆出新增或改動的部分')
  })

  it('提示包含今天日期與 JSON 格式說明', () => {
    const prompt = buildFragmentPrompt('內容', { today: TODAY, sourceKind: 'transcript' })
    expect(prompt).toContain('2026-11-21（週六）')
    expect(prompt).toContain('"fragments"')
    expect(prompt).toContain('transcript')
  })

  it('ALMNC-57.3：會議逐字稿要抽出決議、待辦與負責人；其他形式沒有這段', () => {
    const prompt = buildFragmentPrompt('Scott Chen：好，那就這樣決定。', { today: TODAY, sourceKind: 'meeting' })
    expect(prompt).toContain('會議的逐字稿')
    expect(prompt).toContain('決議')
    expect(prompt).toContain('負責人')
    // 提示要在資料源本文之前。
    expect(prompt.indexOf('負責人')).toBeLessThan(prompt.indexOf('--- 資料源 ---'))
    expect(buildFragmentPrompt('內容', { today: TODAY, sourceKind: 'email' })).not.toContain('會議的逐字稿')
  })

  it('ALMNC-54.10：照建議處理的初步判斷放進提示', () => {
    expect(buildFragmentPrompt('內容', { today: TODAY, hint: '會議紀錄｜拆出任務' })).toContain('以這個建議為準')
    expect(buildFragmentPrompt('內容', { today: TODAY })).not.toContain('初步判斷')
  })

  it('保底片段沒有標題時用來處', () => {
    expect(fallbackFragment('', 'meeting.m4a').title).toBe('meeting.m4a')
  })
})

describe('ALMNC-69.3 判斷理由、信心與「判斷為日誌」', () => {
  it('每個片段都可以帶一行理由與信心（高／低）；log 和舊的 record 都收成日誌筆記', () => {
    const fragments = parseFragments(JSON.stringify({ fragments: [
      { kind: 'note', noteType: 'log', title: '11/10 週會決定留緩衝', date: '2026-11-10', reason: '綁定 11/10 週會，拿掉日期就失去意義 → 日誌筆記', confidence: 'high' },
      { kind: 'note', noteType: 'knowledge', title: '早上寫作效率最好', reason: '可能是日誌也可能是知識', confidence: 'low' },
      { kind: 'task', title: '寄報價單', confidence: 'maybe' },
    ] }))
    expect(fragments[0]).toMatchObject({ noteType: 'record', reason: '綁定 11/10 週會，拿掉日期就失去意義 → 日誌筆記', confidence: 'high' })
    expect(fragments[1]).toMatchObject({ noteType: 'knowledge', confidence: 'low' })
    expect(fragments[2].confidence).toBeUndefined()
    expect(fragments[2].reason).toBeUndefined()
  })

  it('parseJournalVerdict 只在 verdict 為 true 時回傳；信心沒給當成低', () => {
    expect(parseJournalVerdict(JSON.stringify({ journal: { verdict: true, confidence: 'high', reason: 'Scott 寫的整篇下午記錄' }, fragments: [] })))
      .toEqual({ verdict: true, confidence: 'high', reason: 'Scott 寫的整篇下午記錄' })
    expect(parseJournalVerdict(JSON.stringify({ journal: { verdict: 'true' }, fragments: [] }))).toEqual({ verdict: true, confidence: 'low' })
    expect(parseJournalVerdict(JSON.stringify({ journal: { verdict: false, confidence: 'high' }, fragments: [] }))).toBeUndefined()
    expect(parseJournalVerdict(JSON.stringify({ fragments: [] }))).toBeUndefined()
    expect(parseJournalVerdict('壞掉')).toBeUndefined()
  })

  it('dropLogFragments 去掉日誌筆記片段、重新編號；保底片段留著', () => {
    const kept = dropLogFragments(parseFragments(JSON.stringify({ fragments: [
      { kind: 'note', noteType: 'record', title: '下午被打斷', date: '2026-11-03' },
      { kind: 'note', noteType: 'knowledge', title: '切換工作的代價比想像中高' },
    ] })))
    expect(kept.map(f => [f.index, f.title])).toEqual([[0, '切換工作的代價比想像中高']])
    expect(dropLogFragments([fallbackFragment('原文')])).toHaveLength(1)
  })

  it('帶日誌標籤：提示要求不產日誌筆記；模型仍給了也去掉；沒有知識片段就是空的（不退回保底片段）', async () => {
    const prompt = buildFragmentPrompt('11/03 下午被打斷三次', { today: TODAY, journalTagged: true })
    expect(prompt).toContain('帶「日誌」標籤')
    expect(prompt).not.toContain('journal.verdict')
    const ask = vi.fn(async () => JSON.stringify({ fragments: [{ kind: 'note', noteType: 'log', title: '下午被打斷', date: '2026-11-03' }] }))
    expect(await splitSource('11/03 下午被打斷三次', ask, { today: TODAY, journalTagged: true })).toEqual({ fragments: [] })
    const withKnowledge = vi.fn(async () => JSON.stringify({ fragments: [
      { kind: 'note', noteType: 'record', title: '下午被打斷', date: '2026-11-03' },
      { kind: 'note', noteType: 'knowledge', title: '切換工作的代價比想像中高' },
    ] }))
    const result = await splitSource('…', withKnowledge, { today: TODAY, journalTagged: true })
    expect(result.fragments.map(f => f.title)).toEqual(['切換工作的代價比想像中高'])
    expect(result.journal).toBeUndefined()
  })

  it('沒有標籤：提示要指揮官另外判斷是不是日誌；判斷為日誌時帶回判斷、去掉日誌筆記片段', async () => {
    expect(buildFragmentPrompt('…', { today: TODAY })).toContain('journal.verdict')
    const ask = vi.fn(async () => JSON.stringify({
      journal: { verdict: true, confidence: 'low', reason: '第一人稱寫一次經驗' },
      fragments: [{ kind: 'note', noteType: 'log', title: '下午被打斷', date: '2026-11-03' }],
    }))
    expect(await splitSource('我今天下午被打斷三次', ask, { today: TODAY })).toEqual({ fragments: [], journal: { verdict: true, confidence: 'low', reason: '第一人稱寫一次經驗' } })
    const notJournal = vi.fn(async () => JSON.stringify({ journal: { verdict: false }, fragments: [{ kind: 'note', noteType: 'log', title: '11/10 週會', date: '2026-11-10' }] }))
    const plain = await splitSource('週會紀錄', notJournal, { today: TODAY })
    expect(plain.journal).toBeUndefined()
    expect(plain.fragments.map(f => f.noteType)).toEqual(['record'])
  })
})
