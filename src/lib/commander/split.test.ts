import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFragmentPrompt, fallbackFragment, MAX_FRAGMENTS, parseFragments, splitAndClassify } from './split'

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

  it('保底片段沒有標題時用來處', () => {
    expect(fallbackFragment('', 'meeting.m4a').title).toBe('meeting.m4a')
  })
})
