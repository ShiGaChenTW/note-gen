import { describe, expect, it, vi } from 'vitest'
import { indexNote } from './index-note'
import { buildLocalGraph, layoutLocalGraph } from './graph'
const note = (path: string, content = '') => indexNote(path, content, 0)
describe('關聯圖', () => {
  const notes = [note('a.md', '[[b]] [[b]] [[a]] [[missing]]'), note('b.md', '[[c]]'), note('c.md'), note('in.md', '[[a]]')]
  it('包含雙向鄰居、去重並排除自連', () => {
    const graph = buildLocalGraph('a.md', notes, { depth: 1 })
    expect(graph.nodes.map(n => n.id)).toEqual(['a.md', 'b.md', 'in.md', 'unresolved:missing'])
    expect(graph.edges).toEqual([{ source: 'a.md', target: 'b.md' }, { source: 'a.md', target: 'unresolved:missing' }, { source: 'in.md', target: 'a.md' }])
    expect(graph.nodes[3]).toMatchObject({ path: null, distance: 1 })
  })
  it('第二層與截斷依距離、路徑穩定排序', () => {
    const graph = buildLocalGraph('a.md', notes, { depth: 2 })
    expect(graph.nodes.at(-1)).toMatchObject({ id: 'c.md', distance: 2 })
    expect(buildLocalGraph('a.md', [...notes].reverse(), { depth: 2 })).toEqual(graph)
    const limited = buildLocalGraph('a.md', notes, { depth: 2, limit: 2 })
    expect(limited.nodes.map(n => n.id)).toEqual(['a.md', 'b.md'])
    expect(limited.edges).toEqual([{ source: 'a.md', target: 'b.md' }])
    expect(limited.truncated).toBe(true)
  })
  it('未解析節點不展開到其他提及同一目標的筆記', () => {
    expect(buildLocalGraph('a.md', [note('a.md', '[[missing]]'), note('other.md', '[[missing]]')], { depth: 2 }).nodes).toHaveLength(2)
  })
  it('解析相對 Markdown、大小寫與同名筆記，保留輸入', () => {
    const input = [note('f/a.md', '[b](b.md)\r\n[[b]]\r\n'), note('f/b.md'), note('g/b.md')]
    const before = JSON.stringify(input)
    const graph = buildLocalGraph('F/A.MD', input, { depth: 1 })
    expect(graph.nodes.map(n => n.id)).toEqual(['f/a.md', 'f/b.md'])
    expect(graph.nodes[1].folder).toBe('f')
    expect(JSON.stringify(input)).toBe(before)
  })
  it('孤立中心與預設上限', () => {
    expect(buildLocalGraph('a.md', [], { depth: 1 }).edges).toEqual([])
    const graph = buildLocalGraph('a.md', [note('a.md', Array.from({ length: 160 }, (_, i) => '[[' + i + ']]').join(' '))], { depth: 1 })
    expect(graph.nodes).toHaveLength(150)
    expect(graph.truncated).toBe(true)
  })
  it('佈局缺座標時補零，失敗交由呼叫端處理', async () => {
    const graph = buildLocalGraph('a.md', [], { depth: 1 })
    expect((await layoutLocalGraph(graph, async input => input)).get('a.md')).toEqual({ x: 0, y: 0 })
    await expect(layoutLocalGraph(graph, async () => { throw new Error('佈局失敗') })).rejects.toThrow('佈局失敗')
  })
  it('注入佈局並傳入方向與尺寸，不碰 worker', async () => {
    const layout = vi.fn(async (input) => ({ ...input, children: input.children.map((n: object) => ({ ...n, x: 12, y: 34 })) }))
    const positions = await layoutLocalGraph(buildLocalGraph('a.md', notes, { depth: 1 }), layout)
    expect(positions.get('a.md')).toEqual({ x: 12, y: 34 })
    expect(layout.mock.calls[0][0].edges[0]).toMatchObject({ sources: ['a.md'], targets: ['b.md'] })
    expect(await layoutLocalGraph({ nodes: [], edges: [], truncated: false }, layout)).toEqual(new Map())
    expect(layout).toHaveBeenCalledTimes(1)
  })
})
