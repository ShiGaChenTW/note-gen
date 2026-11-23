// Fork（almanac ALMNC-69.11）：「Scott 指定」標記——產生（ops、區塊編輯）、90 天失效、碰到標記的判斷。
import { describe, expect, it } from 'vitest'
import type { OpRecord, OpSpec } from '@/lib/ops/types'
import { changesPinTouches, mocPinTouches, transferPinTouches } from './scott-pin-check'
import { blockPinsFromEdit, isPinActive, pinKey, pinsFromOps, SCOTT_PIN_TTL_MS, type ScottPin } from './scott-pins'

const M = 'M-20261112-060012-VPB3'
const C1 = 'C-20261112-060020-N9NR'
const C2 = 'C-20261112-060021-N9NS'
const UNSORTED = 'C-20261112-060024-3XSV'
const PATH = '20 領域/時間管理.md'
const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

const moc = (parts: { chapter1?: string[], chapter2?: string[], unsorted?: string[], conclusions?: string[], c1Title?: string, noC2?: boolean } = {}) => [
  '---', `id: ${M}`, 'kind: domain', 'title: 時間管理', '---', '# 時間管理', '',
  '## ① 定位問題', '怎麼安排時間？', '',
  '## ③ 章節', '',
  `### ${parts.c1Title ?? '什麼時候做'}`, `<!-- ${C1} -->`, ...(parts.chapter1 ?? ['- [[番茄鐘]] ── 切成小段', '- [[時段]] ── 說明時段']), '',
  ...(parts.noC2 ? [] : ['### 怎麼排', `<!-- ${C2} -->`, ...(parts.chapter2 ?? ['- [[日程]] ── 排法']), '']),
  '### 尚未分章', `<!-- ${UNSORTED} -->`, ...(parts.unsorted ?? ['- [[新筆記]]']), '',
  '## ④ 重點結論', ...(parts.conclusions ?? ['- 舊結論 [[番茄鐘]]']), '',
  '## ⑤ 待釐清', '- 未解：需要例子嗎？', '',
].join('\n')

const BASE = moc()
const entryPin = (note: string, at = NOW - DAY, extra: Partial<ScottPin> = {}): ScottPin => ({ kind: 'position', mocPath: PATH, mocId: M, mocName: '時間管理', notePath: `筆記/${note}.md`, at, ...extra })
const blockPin = (block: ScottPin['block'], at = NOW - DAY): ScottPin => ({ kind: 'block', block, mocPath: PATH, mocId: M, mocName: '時間管理', at })
const chapterPin = (chapterId: string, at = NOW - DAY): ScottPin => ({ kind: 'chapter-title', chapterId, mocPath: PATH, mocId: M, mocName: '時間管理', at })
const resolve = (target: string) => ({ path: `筆記/${target}.md` })
const touches = (after: string | null, pins: ScottPin[], before: string | null = BASE) => mocPinTouches({ path: PATH, before, after }, pins, { now: NOW, resolve })

describe('90 天失效', () => {
  it('標記後未滿 90 天有效，滿 90 天失效', () => {
    expect(isPinActive({ at: NOW - SCOTT_PIN_TTL_MS + 1 }, NOW)).toBe(true)
    expect(isPinActive({ at: NOW - 89 * DAY }, NOW)).toBe(true)
    expect(isPinActive({ at: NOW - 90 * DAY }, NOW)).toBe(false)
  })

  it('過期的標記不再擋', () => {
    const after = moc({ chapter1: ['- [[番茄鐘]] ── 改寫說明', '- [[時段]] ── 說明時段'] })
    expect(touches(after, [entryPin('番茄鐘')])).toHaveLength(1)
    expect(touches(after, [entryPin('番茄鐘', NOW - 90 * DAY)])).toEqual([])
  })
})

describe('同一個位置一個鍵', () => {
  it('改說明與加入／搬動是同一個收錄位置；區塊、章節各自一個', () => {
    const position = entryPin('番茄鐘', 1, { noteId: 'N-1' })
    expect(pinKey(position)).toBe(pinKey({ ...position, kind: 'relation', at: 2, chapterId: C2 }))
    expect(pinKey(position)).toBe(`entry|${M}|N-1`)
    expect(pinKey(blockPin('conclusions'))).toBe(`block|${M}|conclusions`)
    expect(pinKey(chapterPin(C1))).toBe(`chapter|${M}|${C1}`)
    expect(pinKey({ ...entryPin('番茄鐘'), mocId: undefined })).toBe(`entry|path:${PATH}|path:筆記/番茄鐘.md`)
  })
})

describe('產生標記', () => {
  const record = (payload: OpSpec, actor: OpRecord['actor'] = 'scott'): OpRecord => ({
    id: `op-${payload.kind}`, at: NOW, seq: 0, actor, kind: payload.kind, payload, inverse: payload, baseVersions: {}, undoneAt: null,
  })
  const ref = { noteId: 'N-1', noteTitle: '番茄鐘', notePath: '筆記/番茄鐘.md', mocId: M, mocName: '時間管理', mocPath: PATH }

  it('Scott 在 App 內的加入、搬動、改說明、章節改名都標；移除、夥伴的操作不標', () => {
    const pins = pinsFromOps([
      record({ kind: 'moc.entry.add', ...ref, chapterId: UNSORTED }),
      record({ kind: 'moc.entry.move', ...ref, fromChapterId: C1, toChapterId: C2 }),
      record({ kind: 'moc.entry.relation', ...ref, chapterId: C2, before: 'a', after: 'b' }),
      record({ kind: 'moc.chapter.rename', mocId: M, mocName: '時間管理', mocPath: PATH, chapterId: C1, before: 'a', after: 'b' }),
      record({ kind: 'moc.entry.remove', ...ref, chapterId: C1 }),
      record({ kind: 'moc.entry.add', ...ref, chapterId: C1 }, 'expert'),
    ])
    expect(pins.map(pin => [pin.kind, pin.chapterId, pin.opId])).toEqual([
      ['position', UNSORTED, 'op-moc.entry.add'],
      ['position', C2, 'op-moc.entry.move'],
      ['relation', C2, 'op-moc.entry.relation'],
      ['chapter-title', C1, 'op-moc.chapter.rename'],
    ])
    expect(pins[0]).toMatchObject({ noteId: 'N-1', notePath: '筆記/番茄鐘.md', mocId: M, at: NOW })
  })

  it('Obsidian 改了哪個區塊就標哪個；章節區、沒看過的 MOC 不標', () => {
    const after = moc({ conclusions: ['- 新結論 [[番茄鐘]]'], chapter1: ['- [[番茄鐘]] ── 換說明', '- [[時段]] ── 說明時段'] })
    expect(blockPinsFromEdit(BASE, after, { mocPath: PATH, at: NOW })).toEqual([
      { kind: 'block', block: 'conclusions', mocPath: PATH, mocId: M, mocName: '時間管理', at: NOW },
    ])
    expect(blockPinsFromEdit(null, after, { mocPath: PATH, at: NOW })).toEqual([])
    expect(blockPinsFromEdit(BASE, BASE, { mocPath: PATH, at: NOW })).toEqual([])
  })
})

describe('碰到標記', () => {
  it('收錄：搬到別章、改說明、移除都算；同一則筆記沒動、別的收錄動了不算', () => {
    const pin = entryPin('番茄鐘')
    expect(touches(moc({ chapter1: ['- [[時段]] ── 說明時段'], chapter2: ['- [[日程]] ── 排法', '- [[番茄鐘]] ── 切成小段'] }), [pin])).toMatchObject([{ location: 'entry', label: '番茄鐘', mocName: '時間管理' }])
    expect(touches(moc({ chapter1: ['- [[番茄鐘]] ── 新說明', '- [[時段]] ── 說明時段'] }), [pin])).toHaveLength(1)
    expect(touches(moc({ chapter1: ['- [[時段]] ── 說明時段'] }), [pin])).toHaveLength(1)
    expect(touches(moc({ chapter1: ['- [[番茄鐘]] ── 切成小段', '- [[時段]] ── 改了別條'] }), [pin])).toEqual([])
  })

  it('收錄還在尚未分章：排進正式章節不算（保護的是歸屬），拿掉才算', () => {
    const pin = entryPin('新筆記')
    expect(touches(moc({ unsorted: [], chapter2: ['- [[日程]] ── 排法', '- [[新筆記]] ── 回答怎麼排'] }), [pin])).toEqual([])
    expect(touches(moc({ unsorted: [] }), [pin])).toHaveLength(1)
  })

  it('沒有解析器時用檔名比對連結文字；有 N 編號時以編號為準', () => {
    const after = moc({ chapter1: ['- [[時段]] ── 說明時段'] })
    expect(mocPinTouches({ path: PATH, before: BASE, after }, [entryPin('番茄鐘')], { now: NOW })).toHaveLength(1)
    const byId = mocPinTouches({ path: PATH, before: BASE, after }, [entryPin('改名前', NOW - DAY, { noteId: 'N-9' })], {
      now: NOW, resolve: target => target === '番茄鐘' ? { path: '筆記/番茄鐘.md', id: 'N-9' } : { path: `筆記/${target}.md` },
    })
    expect(byId).toHaveLength(1)
  })

  it('區塊：內容改了才算；別的區塊改了不算', () => {
    expect(touches(moc({ conclusions: ['- 舊結論 [[番茄鐘]]', '- 新的一條 [[時段]]'] }), [blockPin('conclusions')])).toMatchObject([{ location: 'block', block: 'conclusions' }])
    expect(touches(moc({ conclusions: ['- 新的一條 [[時段]]'] }), [blockPin('open')])).toEqual([])
  })

  it('章節：改名、被併掉都算', () => {
    expect(touches(moc({ c1Title: '改名' }), [chapterPin(C1)])).toMatchObject([{ location: 'chapter', label: '什麼時候做' }])
    expect(touches(moc({ noC2: true }), [chapterPin(C2)])).toMatchObject([{ location: 'chapter', label: '怎麼排' }])
    expect(touches(moc({ noC2: true }), [chapterPin(C1)])).toEqual([])
  })

  it('MOC 整個刪掉時全部算；新檔、別的 MOC、不是 MOC 的檔案不算', () => {
    expect(touches(null, [entryPin('番茄鐘'), blockPin('open')])).toHaveLength(2)
    expect(touches(moc({ conclusions: [] }), [blockPin('conclusions')], null)).toEqual([])
    expect(touches(moc({ conclusions: [] }), [{ ...blockPin('conclusions'), mocId: 'M-OTHER', mocPath: 'x.md' }])).toEqual([])
    expect(changesPinTouches([{ target: 'note', path: '筆記/番茄鐘.md', before: '# a\n', after: '# b\n' }], [entryPin('番茄鐘')], { now: NOW })).toEqual([])
    expect(changesPinTouches([{ target: 'domain', path: PATH, before: BASE, after: moc({ conclusions: [] }) }], [blockPin('conclusions')], { now: NOW })).toEqual([])
  })

  it('MOC 改名或搬家後依 M 編號仍認得', () => {
    const after = moc({ conclusions: [] })
    expect(mocPinTouches({ path: '20 領域/新名.md', before: BASE, after }, [blockPin('conclusions')], { now: NOW })).toHaveLength(1)
  })

  it('合併、取代會換掉有標記的收錄', () => {
    const pins = [entryPin('番茄鐘', NOW - DAY, { noteId: 'N-1' }), blockPin('open')]
    expect(transferPinTouches([{ from: '筆記/番茄鐘.md', to: '筆記/新.md' }], pins, { now: NOW })).toHaveLength(1)
    expect(transferPinTouches([{ from: '筆記/改名.md', to: '筆記/新.md' }], pins, { now: NOW, idOf: () => 'N-1' })).toHaveLength(1)
    expect(transferPinTouches([{ from: '筆記/時段.md', to: '筆記/新.md' }], pins, { now: NOW })).toEqual([])
    expect(transferPinTouches([{ from: '筆記/番茄鐘.md', to: '筆記/新.md' }], [entryPin('番茄鐘', NOW - 90 * DAY)], { now: NOW })).toEqual([])
  })
})
