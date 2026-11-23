// @vitest-environment jsdom
// Fork（almanac ALMNC-65.1）：提案卡的風險標記與差異檢視。
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import type { DecideItem } from '@/lib/decide/project'
import type { WorkbenchCard } from '@/lib/workbench/cards'
import type { ContentChange } from '@/lib/workbench/risk'
import type { ScottPin } from '@/lib/moc/scott-pins'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})
// decide-parts 會拉進 store 與 Tauri；這裡只需要 DiffBlock 的替身。
vi.mock('./decide-parts', () => ({ DiffBlock: () => h('div', { 'data-testid': 'decide-diff' }) }))

const { ProposalChanges, RiskBadge, ScottPinBadge } = await import('./proposal-risk')
const { default: useScottPinsStore } = await import('@/stores/scott-pins')

const BEFORE = '# 注意力殘留\n\n番茄鐘可以減少切換。\n'
const LINKED = '# 注意力殘留\n\n[[番茄鐘]]可以減少切換。\n'

function item(changes?: ContentChange[]): DecideItem {
  return {
    key: 'draft:t:d', source: 'draft', kind: 'update', title: 'a.md', origin: '', summary: '', when: '', at: 0,
    preview: { type: 'file', path: 'a.md', diff: { context: [], removed: ['x'], added: ['y'], hidden: 0 } },
    duplicates: [], ref: { source: 'draft', taskId: 't', draftId: 'd' }, status: 'wait',
    ...(changes ? { changes } : {}),
  }
}

function card(decide: DecideItem, verb: WorkbenchCard['verb'] = 'modify'): WorkbenchCard {
  return { key: decide.key, kind: 'proposal', group: 'proposal', label: 'note', verb, title: 'a', summary: '', at: 0, actions: [], decide }
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  useScottPinsStore.getState().setPins('', [])
  act(() => root.unmount())
  container.remove()
})

function render(node: ReactNode) {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages, children: node })))
}

describe('RiskBadge', () => {
  it('只補一則連結的提案標「低風險」', () => {
    const decide = item([{ target: 'note', path: 'a.md', before: BEFORE, after: LINKED }])
    render(h(RiskBadge, { card: card(decide) }))
    expect(container.querySelector('[data-testid="card-risk-badge"]')?.textContent).toBe('低風險')
  })

  it('高風險、不是提案的卡不標', () => {
    render(h(RiskBadge, { card: card(item([{ target: 'note', path: 'a.md', before: BEFORE, after: '改掉了\n' }])) }))
    expect(container.querySelector('[data-testid="card-risk-badge"]')).toBeNull()
    render(h(RiskBadge, { card: { ...card(item()), decide: undefined, kind: 'task' } }))
    expect(container.querySelector('[data-testid="card-risk-badge"]')).toBeNull()
  })
})

describe('ProposalChanges', () => {
  it('寫出風險等級，並列出前後差異', () => {
    const decide = item([{ target: 'note', path: 'a.md', before: BEFORE, after: LINKED }])
    render(h(ProposalChanges, { card: card(decide), item: decide }))
    const section = container.querySelector('[data-testid="card-changes"]')!
    expect(section.getAttribute('data-risk')).toBe('low')
    expect(section.textContent).toContain('低風險')
    const diff = container.querySelector('[data-testid="change-diff"]')!.textContent!
    expect(diff).toContain('- 番茄鐘可以減少切換。')
    expect(diff).toContain('+ [[番茄鐘]]可以減少切換。')
    expect(diff).toContain('+1 −1')
  })

  it('高風險會寫理由；多份改動各自標出是哪一份', () => {
    const decide = item([
      { target: 'note', path: 'a.md', before: BEFORE, after: LINKED },
      { target: 'domain', path: 'd1', before: '舊總覽', after: '新總覽' },
    ])
    render(h(ProposalChanges, { card: card(decide, 'supplement'), item: decide }))
    expect(container.querySelector('[data-testid="card-changes"]')?.getAttribute('data-risk')).toBe('high')
    expect(container.textContent).toContain('請看過再接受')
    expect(container.querySelectorAll('[data-testid="change-diff"]')).toHaveLength(2)
    expect(container.textContent).toContain('領域總覽')
  })

  it('沒有完整前後文時退回原本的差異預覽', () => {
    const decide = item()
    render(h(ProposalChanges, { card: card(decide, 'add'), item: decide }))
    expect(container.querySelector('[data-testid="decide-diff"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="change-diff"]')).toBeNull()
  })
})

// Fork（almanac ALMNC-69.11）：夥伴的提案仍要改到 Scott 指定的位置時，卡片明確標出。
describe('Scott 指定的位置', () => {
  const MOC = '20 領域/時間管理.md'
  const before = '---\nid: M-1\nkind: domain\ntitle: 時間管理\n---\n# 時間管理\n\n## ③ 章節\n\n### 什麼時候做\n<!-- C-20261112-060020-N9NR -->\n- [[番茄鐘]] ── 切成小段\n\n## ④ 重點結論\n- 舊結論\n'
  const after = before.replace('- 舊結論', '- 新結論').replace('### 什麼時候做', '### 何時做')
  const pins: ScottPin[] = [
    { kind: 'block', block: 'conclusions', mocPath: MOC, mocId: 'M-1', mocName: '時間管理', at: Date.now() - 1000 },
    { kind: 'chapter-title', chapterId: 'C-20261112-060020-N9NR', mocPath: MOC, mocId: 'M-1', mocName: '時間管理', at: Date.now() - 1000 },
  ]
  const decide = item([{ target: 'note', path: MOC, before, after }])

  it('展開後寫出「這是 Scott 指定的位置」與碰到的區塊、章節；收合列標「Scott 指定」', () => {
    useScottPinsStore.getState().setPins('/v', pins)
    render(h('div', null, h(ScottPinBadge, { card: card(decide) }), h(ProposalChanges, { card: card(decide), item: decide })))
    expect(container.querySelector('[data-testid="card-scott-pin-badge"]')?.textContent).toBe('Scott 指定')
    const notice = container.querySelector('[data-testid="card-scott-pin"]')!
    expect(notice.textContent).toContain('這是 Scott 指定的位置')
    expect(notice.textContent).toContain('時間管理：重點結論')
    expect(notice.textContent).toContain('時間管理：「什麼時候做」章')
  })

  it('沒有標記、標記過期或改的是別處時不標', () => {
    render(h(ProposalChanges, { card: card(decide), item: decide }))
    expect(container.querySelector('[data-testid="card-scott-pin"]')).toBeNull()
    useScottPinsStore.getState().setPins('/v', pins.map(pin => ({ ...pin, at: Date.now() - 91 * 24 * 60 * 60 * 1000 })))
    render(h(ProposalChanges, { card: card(decide), item: decide }))
    expect(container.querySelector('[data-testid="card-scott-pin"]')).toBeNull()
    useScottPinsStore.getState().setPins('/v', pins)
    const elsewhere = item([{ target: 'note', path: 'a.md', before: BEFORE, after: LINKED }])
    render(h('div', null, h(ScottPinBadge, { card: card(elsewhere) }), h(ProposalChanges, { card: card(elsewhere), item: elsewhere })))
    expect(container.querySelector('[data-testid="card-scott-pin"]')).toBeNull()
    expect(container.querySelector('[data-testid="card-scott-pin-badge"]')).toBeNull()
  })
})
