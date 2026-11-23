// Fork（almanac ALMNC-65.1）：風險判斷——每種動作類型、補一般連結回 low、名義上補連結但實際改了內文或歸屬回 high。
import { describe, expect, it } from 'vitest'
import { proposalChanges, type DecideItem } from '@/lib/decide/project'
import type { Proposal } from '@/lib/collect/types'
import { CARD_VERBS, type CardVerb } from './cards'
import { cardRisk, isMocContent, isSingleLinkAddition, LINK_CANDIDATE_VERBS, riskOf, type ContentChange } from './risk'

const NOTE = `---
id: N-20261120-010203-ABCD
type: knowledge
domains:
  - 時間管理
---
# 注意力殘留

切換工作之後，注意力會留在上一件事上。
番茄鐘可以減少切換。
`

const linkAdded = NOTE.replace('番茄鐘可以減少切換。', '番茄鐘可以減少切換。\n\n- [[切換工作的代價比想像中高]]')
const mentionWrapped = NOTE.replace('番茄鐘可以', '[[番茄鐘]]可以')

function note(before: string | null, after: string | null, path = '10 知識筆記/注意力殘留.md'): ContentChange {
  return { target: 'note', path, before, after }
}

describe('riskOf：每種動作類型', () => {
  const linkOnly = [note(NOTE, linkAdded)]

  it.each(CARD_VERBS.filter(verb => !LINK_CANDIDATE_VERBS.includes(verb)))('%s 不看內容，一律 high（就算內容只補了一則連結）', verb => {
    expect(riskOf({ verb, changes: linkOnly })).toBe('high')
  })

  it.each(LINK_CANDIDATE_VERBS)('%s 只補一則一般連結 → low', verb => {
    expect(riskOf({ verb, changes: linkOnly })).toBe('low')
  })

  it.each(LINK_CANDIDATE_VERBS)('%s 把原文的提及包成連結 → low', verb => {
    expect(riskOf({ verb, changes: [note(NOTE, mentionWrapped)] })).toBe('low')
  })

  it('不認得的動詞、沒有動詞 → high', () => {
    expect(riskOf({ verb: 'link', changes: linkOnly })).toBe('high')
    expect(riskOf({ verb: undefined, changes: linkOnly })).toBe('high')
  })

  it('判斷不出改了什麼（沒有改動、改動是空的） → high', () => {
    expect(riskOf({ verb: 'supplement' })).toBe('high')
    expect(riskOf({ verb: 'supplement', changes: [] })).toBe('high')
  })
})

describe('riskOf：名義上補連結，實際改了別的 → high', () => {
  const verb: CardVerb = 'supplement'

  it('連結之外還改了內文', () => {
    const after = linkAdded.replace('注意力會留在', '注意力常常留在')
    expect(riskOf({ verb, changes: [note(NOTE, after)] })).toBe('high')
  })

  it('改了歸屬（frontmatter domains）', () => {
    const after = linkAdded.replace('  - 時間管理', '  - 時間管理\n  - 專注力')
    expect(riskOf({ verb, changes: [note(NOTE, after)] })).toBe('high')
  })

  it('改了 frontmatter 的其他欄位（類型）', () => {
    expect(riskOf({ verb, changes: [note(NOTE, linkAdded.replace('type: knowledge', 'type: project'))] })).toBe('high')
  })

  it('在 MOC 上加連結（可能是正式收錄＝改歸屬）', () => {
    const moc = '---\nid: M-20261112-060012-VPB3\nkind: domain\n---\n# 時間管理\n\n## 尚未分章\n- [[說不比提高效率更省時間]]\n'
    const after = moc.replace('- [[說不比提高效率更省時間]]', '- [[說不比提高效率更省時間]]\n- [[注意力殘留]]')
    expect(riskOf({ verb, changes: [note(moc, after, '20 領域/時間管理.md')] })).toBe('high')
  })

  it('一次補兩則連結', () => {
    const after = linkAdded.replace('- [[切換工作的代價比想像中高]]', '- [[切換工作的代價比想像中高]]\n- [[時間區塊要留兩成緩衝]]')
    expect(riskOf({ verb, changes: [note(NOTE, after)] })).toBe('high')
  })

  it('改了兩則筆記', () => {
    expect(riskOf({ verb, changes: [note(NOTE, linkAdded), note(NOTE, linkAdded, '10 知識筆記/另一則.md')] })).toBe('high')
  })

  it('嵌入（![[…]]）不算一般連結', () => {
    expect(riskOf({ verb, changes: [note(NOTE, NOTE.replace('番茄鐘可以減少切換。', '番茄鐘可以減少切換。\n![[圖.png]]'))] })).toBe('high')
  })

  it('改了既有連結的目標', () => {
    const before = NOTE.replace('番茄鐘可以', '[[番茄鐘]]可以')
    const after = before.replace('[[番茄鐘]]', '[[番茄工作法]]').replace('番茄鐘可以減少切換。', '')
    expect(riskOf({ verb, changes: [note(before, after)] })).toBe('high')
  })

  it('新增、刪除、搬移的檔案', () => {
    expect(riskOf({ verb, changes: [note(null, linkAdded)] })).toBe('high')
    expect(riskOf({ verb, changes: [note(NOTE, null)] })).toBe('high')
    expect(riskOf({ verb, changes: [note(null, null)] })).toBe('high')
  })

  it('改的是領域總覽或角色記憶', () => {
    expect(riskOf({ verb, changes: [{ target: 'domain', path: 'd1', before: '總覽', after: '總覽 [[注意力殘留]]' }] })).toBe('high')
    expect(riskOf({ verb, changes: [{ target: 'memory', path: 'Mia/rules.md', before: '規則', after: '規則 [[注意力殘留]]' }] })).toBe('high')
  })

  it('什麼都沒改', () => {
    expect(riskOf({ verb, changes: [note(NOTE, NOTE)] })).toBe('high')
  })
})

describe('isSingleLinkAddition', () => {
  it('行內插入，連同前面的分隔符號', () => {
    const before = '相關：[[專注力]]\n'
    expect(isSingleLinkAddition(before, '相關：[[專注力]]、[[習慣養成]]\n')).toBe(true)
    expect(isSingleLinkAddition('見 這裡。\n', '見 [[習慣養成]] 這裡。\n')).toBe(true)
  })

  it('別名與標題連結包住原文的提及', () => {
    expect(isSingleLinkAddition('番茄鐘有用\n', '[[番茄工作法|番茄鐘]]有用\n')).toBe(true)
    expect(isSingleLinkAddition('番茄鐘有用\n', '[[番茄鐘#結論]]有用\n')).toBe(true)
  })

  it('沒有 frontmatter 的筆記也能判斷；frontmatter 從無到有不行', () => {
    expect(isSingleLinkAddition('一\n', '一 [[二]]\n')).toBe(true)
    expect(isSingleLinkAddition('一\n', '---\na: 1\n---\n一 [[二]]\n')).toBe(false)
  })

  it('MOC 判斷：kind: domain 或 M 編號', () => {
    expect(isMocContent('---\nkind: domain\n---\n')).toBe(true)
    expect(isMocContent('---\nid: M-20261104-014500-A57V\n---\n')).toBe(true)
    expect(isMocContent(NOTE)).toBe(false)
  })
})

describe('cardRisk 與 proposalChanges', () => {
  function item(changes?: ContentChange[]): DecideItem {
    return {
      key: 'k', source: 'collect', kind: 'update', title: 't', origin: '', summary: '', when: '', at: 0,
      preview: { type: 'file', path: 'a.md', diff: null }, duplicates: [], ref: { source: 'collect', itemId: 'i', proposalId: 'p' }, status: 'wait',
      ...(changes ? { changes } : {}),
    }
  }

  it('提案卡用 decide.changes；不是提案的卡 → high', () => {
    expect(cardRisk({ verb: 'supplement', decide: item([note(NOTE, linkAdded)]) })).toBe('low')
    expect(cardRisk({ verb: 'supplement', decide: item() })).toBe('high')
    expect(cardRisk({ verb: 'supplement' })).toBe('high')
  })

  it('提案的所有改動都收進來：筆記變更、檔案變更、領域總覽、角色記憶', () => {
    const proposal: Proposal = {
      id: 'p', kind: 'note', title: 't', body: '', due: '', time: '', tags: [],
      edits: [{ path: 'a.md', baseContent: NOTE, content: linkAdded, summary: '' }],
      domainEdits: [{ domainId: 'd1', baseOverview: 'x', overview: 'y', summary: '' }],
      memoryEdits: [{ target: 'rules', agent: { id: 'a1', name: 'Mia', role: 'commander' }, baseContent: 'r', content: '', summary: '' }],
      change: { toolName: 'move_file', args: {}, kind: 'move', path: 'b.md', targetPath: 'c.md', baseContent: 'old', summary: '' },
    }
    expect(proposalChanges(proposal)).toEqual([
      note(NOTE, linkAdded, 'a.md'),
      { target: 'note', path: 'b.md', before: null, after: null },
      { target: 'domain', path: 'd1', before: 'x', after: 'y' },
      { target: 'memory', path: 'Mia/rules.md', before: 'r', after: '' },
    ])
    expect(riskOf({ verb: 'supplement', changes: proposalChanges(proposal) })).toBe('high')
    expect(riskOf({ verb: 'supplement', changes: proposalChanges({ ...proposal, change: undefined, domainEdits: undefined, memoryEdits: undefined }) })).toBe('low')
  })
})
