// Fork（almanac ALMNC-54.8）：審核分頁的卡片投影——分組排序（AC#3）、標籤篩選（AC#1）、動詞與按鈕（AC#2）。
import { describe, expect, it } from 'vitest'
import type { DecideItem } from '@/lib/decide/project'
import type { TaskRef } from '@/lib/vault-index/index-core'
import {
  ACTIONS_BY_KIND, actionLabelKey, sourceCardActions, CARD_LABELS, CARD_VERBS, actionForKey, ageParts, buildReviewCards, filterCards, groupCards, labelCounts, nextCursor,
  proposalLabel, proposalVerb,
} from './cards'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-21T10:00:00')

function proposal(key: string, at: number, extra: Partial<DecideItem> = {}): DecideItem {
  return {
    key, source: 'collect', kind: 'note', title: `提案 ${key}`, origin: '11/19 產線檢討', summary: '', when: '', at,
    preview: { type: 'newNote', diff: { context: [], removed: [], added: [], hidden: 0 } },
    duplicates: [], ref: { source: 'collect', itemId: key, proposalId: 'p' }, status: 'wait', ...extra,
  }
}

function task(title: string, due: string, line = 0): TaskRef {
  return { path: 'daily/2026-11-18.md', line, title, due, time: '', done: false, raw: `- [ ] ${title}`, recurrence: '', priority: 'mid' }
}

describe('buildReviewCards', () => {
  it('AC#3: sorts 等回話 → 逾期 → 提案（舊在前）→ 親手整理 → 其他任務', () => {
    const cards = buildReviewCards({
      now: NOW,
      otherTasks: [task('下週的事', '2026-11-23', 3)],
      hand: [{ key: 'hand:1', label: 'knowledge', title: '產線平衡', more: 4, summary: '重疊很多', at: NOW - DAY }],
      proposals: [proposal('new', NOW - 3600_000), proposal('old', NOW - 2 * DAY)],
      overdueTasks: [task('寄報價單給 B 公司', '2026-11-18', 1)],
      replies: [{ key: 'reply:1', title: '跟 A 開會，要哪個時間？', summary: '你說「下週找時間」', at: NOW }],
    })
    expect(cards.map(card => card.group)).toEqual(['reply', 'late', 'proposal', 'proposal', 'hand', 'task'])
    expect(cards.filter(card => card.group === 'proposal').map(card => card.key)).toEqual(['old', 'new'])
    expect(groupCards(cards).map(entry => entry.group)).toEqual(['reply', 'late', 'proposal', 'hand', 'task'])
  })

  it('puts sources awaiting a decision, domain and confirm cards into the 提案 group by age', () => {
    const cards = buildReviewCards({
      now: NOW,
      proposals: [proposal('p', NOW - DAY)],
      awaitingSources: [{ id: 's1', title: '會議錄音 · 11/19 產線檢討', kindLabel: '錄音', judgement: '', origin: '產線檢討.m4a', collectedAt: NOW - 2 * DAY }],
      domains: [{ id: 'domain:資料工程', title: '成立領域「資料工程」', summary: '3 則', notePaths: ['a.md', 'b.md', 'c.md'], at: NOW }],
      confirm: [{ path: '知識/供應商交期基準.md', title: '供應商交期基準', lastConfirmed: '2025-08-20' }],
    })
    expect(cards.map(card => card.key)).toEqual(['confirm:知識/供應商交期基準.md', 'source:s1', 'p', 'domain:資料工程'])
    const source = cards.find(card => card.kind === 'source')!
    expect(source).toMatchObject({ label: 'source', verb: 'judge', summary: '產線檢討.m4a', actions: ['process', 'selfProcess', 'reject'] })
    expect(cards.find(card => card.kind === 'domain')).toMatchObject({ label: 'knowledge', more: 2, actions: ['accept', 'discuss', 'drop'] })
    expect(cards.find(card => card.kind === 'confirm')).toMatchObject({ label: 'note', verb: 'confirm', path: '知識', actions: ['stillValid', 'toCommander'] })
  })

  it('AC#2: card three-line fields — 標的物, 路徑或時間, 誰建議的＋摘要, and 等 N 則', () => {
    const [file] = buildReviewCards({
      now: NOW,
      proposals: [proposal('d', NOW, {
        source: 'draft', kind: 'update', title: '知識/工業工程/OEE 的定義.md', summary: '', origin: 'Mia 的整理任務',
        preview: { type: 'file', path: '知識/工業工程/OEE 的定義.md', diff: null }, duplicates: [{ source: 'collect', itemId: 'x', proposalId: 'y' }],
      })],
    })
    expect(file).toMatchObject({ title: 'OEE 的定義', path: '知識/工業工程', summary: 'Mia 的整理任務', verb: 'modify', more: 1 })
    const [late] = buildReviewCards({ now: NOW, overdueTasks: [task('寄報價單', '2026-11-18')], proposals: [] })
    expect(late).toMatchObject({ label: 'schedule', verb: 'reschedule', path: '11/18', overdue: true, actions: ['schedule', 'done'] })
  })
})

describe('labels and verbs', () => {
  it('has exactly the eleven verbs and five labels of the spec', () => {
    expect(CARD_VERBS).toEqual(['add', 'supplement', 'modify', 'merge', 'replace', 'verify', 'archive', 'reschedule', 'judge', 'confirm', 'organize'])
    expect(CARD_LABELS).toEqual(['schedule', 'note', 'knowledge', 'source', 'review'])
  })

  it('AC#2: buttons follow the card type', () => {
    expect(ACTIONS_BY_KIND.proposal).toEqual(['accept', 'discuss', 'drop'])
    expect(ACTIONS_BY_KIND.reply).toEqual(['answer'])
    expect(ACTIONS_BY_KIND.hand).toEqual(['desk'])
    expect(ACTIONS_BY_KIND.task).toEqual(['schedule', 'done'])
    expect(ACTIONS_BY_KIND.confirm).toEqual(['stillValid', 'toCommander'])
  })

  it('maps proposals to labels and verbs; stale proposals (14 days) become 回顧', () => {
    expect(proposalLabel(proposal('a', NOW, { kind: 'task' }), NOW)).toBe('schedule')
    expect(proposalLabel(proposal('a', NOW), NOW)).toBe('note')
    expect(proposalLabel(proposal('a', NOW - 15 * DAY, { kind: 'task' }), NOW)).toBe('review')
    expect(proposalVerb(proposal('a', NOW, { kind: 'delete' }))).toBe('archive')
    expect(proposalVerb(proposal('a', NOW, { kind: 'move' }))).toBe('organize')
    expect(proposalVerb(proposal('a', NOW, { organizeMerge: { removed: 'a', keeper: 'b' } }))).toBe('merge')
    expect(proposalVerb(proposal('a', NOW, { kind: 'event', preview: { type: 'file', path: 'daily.md', diff: null } }))).toBe('reschedule')
    expect(proposalVerb(proposal('a', NOW, { kind: 'task' }))).toBe('add')
  })

  it('reply cards with choices offer 選一個', () => {
    const [card] = buildReviewCards({ now: NOW, proposals: [], replies: [{ key: 'r', title: '要哪個時間？', summary: '', at: NOW, choices: ['11/25 10:00', '11/26 14:00'] }] })
    expect(card.actions).toEqual(['pick', 'answer'])
    expect(card.choices).toHaveLength(2)
  })
})

describe('filters', () => {
  const cards = buildReviewCards({
    now: NOW,
    proposals: [proposal('n', NOW), proposal('t', NOW, { kind: 'task' }), proposal('old', NOW - 20 * DAY)],
    awaitingSources: [{ id: 's', title: '白板照片', kindLabel: '截圖', judgement: '', collectedAt: NOW }],
    overdueTasks: [task('逾期', '2026-11-01')],
  })

  it('AC#1: one undivided list filtered by 日程／筆記／知識／資料源／回顧', () => {
    expect(filterCards(cards, 'all')).toHaveLength(5)
    expect(filterCards(cards, 'schedule').map(card => card.key)).toEqual(['task:daily/2026-11-18.md:0', 't'])
    expect(filterCards(cards, 'note').map(card => card.key)).toEqual(['n'])
    expect(filterCards(cards, 'source').map(card => card.key)).toEqual(['source:s'])
    expect(filterCards(cards, 'review').map(card => card.key)).toEqual(['old'])
    expect(labelCounts(cards)).toEqual({ all: 5, schedule: 2, note: 1, knowledge: 0, source: 1, review: 1 })
  })
})

describe('keyboard helpers', () => {
  const cards = buildReviewCards({ now: NOW, proposals: [proposal('a', NOW - 3), proposal('b', NOW - 2), proposal('c', NOW - 1)] })

  it('maps single keys to the card actions (A／D／X)', () => {
    expect(actionForKey(cards[0], 'a')).toBe('accept')
    expect(actionForKey(cards[0], 'D')).toBe('discuss')
    expect(actionForKey(cards[0], 'x')).toBe('drop')
    expect(actionForKey(cards[0], 'c')).toBeUndefined()
  })

  it('moves the cursor to the next card, or the previous one at the end', () => {
    expect(nextCursor(cards, 'a')).toBe('b')
    expect(nextCursor(cards, 'c')).toBe('b')
    expect(nextCursor([cards[0]], 'a')).toBeNull()
  })

  it('formats the waiting age', () => {
    expect(ageParts(NOW - 60_000, NOW)).toEqual({ unit: 'now', value: 0 })
    expect(ageParts(NOW - 3 * 3600_000, NOW)).toEqual({ unit: 'hour', value: 3 })
    expect(ageParts(NOW - 2 * DAY, NOW)).toEqual({ unit: 'day', value: 2 })
  })
})

describe('ALMNC-54.10 等你［資料源］卡', () => {
  const base = { id: 's1', title: 'https://example.com/a', kindLabel: '網頁', origin: 'https://example.com/a', collectedAt: NOW - DAY }

  it('AC#1/#2: one-line judgement on the third line; 照建議處理／處理／自己處理／不採用（先放著在每張卡上）', () => {
    const [card] = buildReviewCards({ now: NOW, proposals: [], awaitingSources: [{ ...base, judgement: '研究報告｜存成知識筆記', suggestion: '存成知識筆記' }] })
    expect(card).toMatchObject({ summary: '研究報告｜存成知識筆記', actions: ['process', 'handle', 'selfProcess', 'reject'], hasSuggestion: true })
    expect(actionForKey(card, 'a')).toBe('process')
    expect(actionForKey(card, 'p')).toBe('handle')
    expect(actionForKey(card, 'x')).toBe('reject')
    expect(actionLabelKey(card, 'process')).toBe('process')
  })

  it('AC#4: without a judgement the card still shows; 照建議處理 becomes 處理', () => {
    const [card] = buildReviewCards({ now: NOW, proposals: [], awaitingSources: [{ ...base, judgement: '' }] })
    expect(card).toMatchObject({ kind: 'source', summary: 'https://example.com/a', actions: ['process', 'selfProcess', 'reject'] })
    expect(card.hasSuggestion).toBeUndefined()
    expect(actionLabelKey(card, 'process')).toBe('handle')
    expect(actionForKey(card, 'a')).toBe('process')
  })

  it('a type-only judgement (no suggestion) still has no 照建議處理', () => {
    expect(sourceCardActions({ suggestion: undefined })).toEqual(ACTIONS_BY_KIND.source)
  })

  it('capture failed → 重試／刪除', () => {
    const [card] = buildReviewCards({ now: NOW, proposals: [], awaitingSources: [{ ...base, judgement: '擷取失敗', failed: true, suggestion: 'x' }] })
    expect(card).toMatchObject({ summary: '擷取失敗', actions: ['retry', 'delete'] })
    expect(card.hasSuggestion).toBeUndefined()
    expect(actionForKey(card, 'r')).toBe('retry')
    expect(actionForKey(card, 'x')).toBeUndefined() // 刪除沒有單鍵
  })
})

// Fork（almanac ALMNC-54.12）：清理提案（同領域打包＝知識／整理；單則＝筆記＋處理方式）、確認、每週回顧由提案自己指定卡片。
describe('proposal card hints', () => {
  const file = { type: 'file' as const, path: '知識/工業工程/節拍.md', diff: null }
  it('uses the hinted label and verb, shows the folder and 等 N 則 for bundles', () => {
    const bundle = proposal('c1', NOW - DAY, { title: '整理「工業工程」：3 項', preview: file, card: { label: 'knowledge', verb: 'organize' }, notePaths: ['知識/工業工程/節拍.md', 'a.md', 'b.md'] })
    const [card] = buildReviewCards({ now: NOW, proposals: [bundle] })
    expect(card).toMatchObject({ label: 'knowledge', verb: 'organize', title: '整理「工業工程」：3 項', path: '知識/工業工程', more: 2, actions: ACTIONS_BY_KIND.proposal })
    expect(proposalVerb(proposal('c2', NOW, { card: { label: 'note', verb: 'verify' } }))).toBe('verify')
    expect(proposalLabel(proposal('r1', NOW, { card: { label: 'review', verb: 'add' } }), NOW)).toBe('review')
    // 超過 14 天沒決定的一律列進回顧。
    expect(proposalLabel(proposal('c3', NOW - 15 * DAY, { card: { label: 'note', verb: 'verify' } }), NOW)).toBe('review')
  })
})
