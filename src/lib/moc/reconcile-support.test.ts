// Fork（almanac ALMNC-69.10）：App 寫入事件、Scott 指定標記、整批檢查卡。
import { describe, expect, it, vi } from 'vitest'
import { actionLabelKey, buildReviewCards, mocBatchCardKey } from '@/lib/workbench/cards'
import { looksLikeMoc, noteAppWrite, takeAppWrites } from './app-writes'
import type { EffectiveDiff } from './reconcile'
import { pinsFromDiffs, recordScottPins, registerScottPinRecorder } from './scott-pins'

describe('app-writes', () => {
  it('只記 MOC（frontmatter kind: domain）的寫入', () => {
    expect(looksLikeMoc('---\nid: M-1\nkind: domain\n---\n# X\n')).toBe(true)
    expect(looksLikeMoc('---\r\nkind: "domain"\r\n---\r\n')).toBe(true)
    expect(looksLikeMoc('---\ntype: knowledge\n---\nkind: domain\n')).toBe(false)
    takeAppWrites()
    noteAppWrite('a.md', null, '---\nkind: domain\n---\n')
    noteAppWrite('b.md', 'x', '---\ntype: knowledge\n---\n')
    noteAppWrite('c.md', '---\nkind: domain\n---\n', 'kind 被拿掉了')
    expect(takeAppWrites().map(event => event.path)).toEqual(['a.md', 'c.md'])
    expect(takeAppWrites()).toEqual([])
  })
})

describe('scott-pins', () => {
  const base = { mocPath: 'm.md', mocName: '時間管理', mocId: 'M-1' }
  const diffs: EffectiveDiff[] = [
    { ...base, id: '1', kind: 'relation', notePath: 'a.md', target: 'a', chapterId: 'C-1', chapterTitle: '一', before: '舊', after: '新' },
    { ...base, id: '2', kind: 'move', notePath: 'b.md', target: 'b', fromChapterId: 'C-1', fromChapterTitle: '一', toChapterId: 'C-2', toChapterTitle: '二' },
    { ...base, id: '3', kind: 'add', notePath: 'c.md', target: 'c', chapterTitle: '尚未分章', relation: '' },
    { ...base, id: '4', kind: 'remove', notePath: 'd.md', target: 'd', chapterTitle: '一', relation: '' },
    { ...base, id: '5', kind: 'chapter-rename', chapterId: 'C-1', before: '一', after: '壹' },
  ]

  it('改說明標 relation、加入與搬動標 position、章節改名標 chapter-title；移除不標', () => {
    const pins = pinsFromDiffs(diffs, 42, { opIds: ['op1', 'op2', 'op3', 'op4', 'op5'], noteIdOf: path => `N-${path}` })
    expect(pins.map(pin => [pin.kind, pin.notePath ?? null, pin.chapterId ?? null, pin.opId])).toEqual([
      ['relation', 'a.md', 'C-1', 'op1'],
      ['position', 'b.md', 'C-2', 'op2'],
      ['position', 'c.md', null, 'op3'],
      ['chapter-title', null, 'C-1', 'op5'],
    ])
    expect(pins[0]).toMatchObject({ noteId: 'N-a.md', mocId: 'M-1', at: 42 })
  })

  it('69.11 註冊儲存後才存；沒註冊時略過不丟錯', async () => {
    await expect(recordScottPins(pinsFromDiffs(diffs, 1))).resolves.toBeUndefined()
    const store = vi.fn(async () => {})
    registerScottPinRecorder(store)
    await recordScottPins(pinsFromDiffs(diffs, 1))
    expect(store).toHaveBeenCalledTimes(1)
    registerScottPinRecorder(null)
  })
})

describe('整批檢查卡', () => {
  it('有待確認的整批檢查 → 一張 mocBatch 卡（全部接受／全部取消）', () => {
    const cards = buildReviewCards({ proposals: [], now: 100, mocBatch: { id: 'b1', title: '整批檢查：時間管理', summary: '6 處變更', count: 6, by: '系統', at: 50 } })
    const card = cards.find(item => item.kind === 'mocBatch')!
    expect(card).toMatchObject({ key: mocBatchCardKey('b1'), actions: ['accept', 'drop'], title: '整批檢查：時間管理' })
    expect(actionLabelKey(card, 'accept')).toBe('acceptAll')
    expect(actionLabelKey(card, 'drop')).toBe('cancelAll')
    expect(buildReviewCards({ proposals: [], now: 100, mocBatch: null }).some(item => item.kind === 'mocBatch')).toBe(false)
  })
})
