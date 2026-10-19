// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseCanvas, serializeCanvas } from '@/lib/obsidian-canvas/format'
import { toFlow, fromFlow, mayReload, guardedCanvasWrite, canvasColor } from '@/lib/obsidian-canvas/flow'
const raw = JSON.stringify({ nodes: [{ id: 'a', type: 'text', x: 20, y: 30, width: 100, height: 80, text: '不變' }, { id: 'g', type: 'group', x: 10, y: 10, width: 300, height: 300 }], edges: [{ id: 'e', fromNode: 'a', toNode: 'g', fromSide: 'left', toSide: 'right', toEnd: 'none' }] })
describe('Canvas 頁面轉換', () => {
  it('群組先於子節點、相對座標與 side handle', () => {
    const flow = toFlow(parseCanvas(raw).doc!)
    expect(flow.nodes.map(n => n.id)).toEqual(['g', 'a'])
    expect(flow.nodes[1]).toMatchObject({ parentId: 'g', extent: 'parent', position: { x: 10, y: 20 } })
    expect(flow.edges[0]).toMatchObject({ sourceHandle: 'source-left', targetHandle: 'target-right' })
    expect(flow.edges[0].markerEnd).toBeUndefined()
    expect(serializeCanvas(fromFlow(parseCanvas(raw).doc!, flow.nodes, flow.edges), raw)).toBe(raw)
  })
  it('移動群組、縮放及刪除序列化，保留原節點順序與文字', () => {
    const doc = parseCanvas(raw).doc!, flow = toFlow(doc)
    flow.nodes[0].position.x += 40
    flow.nodes[1].width = 120
    const next = fromFlow(doc, flow.nodes, flow.edges)
    expect(next.nodes[0]).toMatchObject({ id: 'a', x: 60, y: 30, width: 120, text: '不變' })
    expect(JSON.parse(serializeCanvas(next)).nodes[1].x).toBe(50)
    expect(fromFlow(doc, flow.nodes.slice(0, 1), flow.edges).edges).toEqual([])
  })
  it('外部變更且有未存修改時保護內容，寫前再次檢查', () => {
    expect(mayReload(raw, raw, true)).toBe('keep')
    expect(mayReload(raw, raw + ' ', true)).toBe('conflict')
    expect(mayReload(raw, raw + ' ', false)).toBe('reload')
    expect(() => guardedCanvasWrite(parseCanvas(raw).doc!, raw, raw + ' ')).toThrow('externalChange')
    expect(guardedCanvasWrite(parseCanvas(raw).doc!, raw, raw)).toBe(raw)
  })
  it('巢狀群組選最小容器，移動最外層帶動全部子節點', () => {
    const doc = parseCanvas(raw).doc!
    doc.nodes.push({ id: 'outer', type: 'group', x: 0, y: 0, width: 500, height: 500, extra: {} })
    const flow = toFlow(doc)
    expect(flow.nodes.map(n => [n.id, n.parentId])).toEqual([['outer', undefined], ['g', 'outer'], ['a', 'g']])
    flow.nodes[0].position = { x: 100, y: -30 }
    const next = fromFlow(doc, flow.nodes, flow.edges)
    expect(next.nodes[0]).toMatchObject({ x: 120, y: 0 })
    expect(next.nodes[1]).toMatchObject({ x: 110, y: -20 })
    expect(next.nodes.map(n => n.id)).toEqual(['a', 'g', 'outer'])
  })
  it('所有方向與雙端箭頭、預設邊方向', () => {
    const doc = parseCanvas(raw).doc!
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      doc.edges[0] = { ...doc.edges[0], fromSide: side, toSide: side, fromEnd: 'arrow', toEnd: 'arrow' }
      const edge = toFlow(doc).edges[0]
      expect(edge.sourceHandle).toBe('source-' + side)
      expect(edge.targetHandle).toBe('target-' + side)
      expect(edge.markerStart).toBeDefined(); expect(edge.markerEnd).toBeDefined()
    }
    delete doc.edges[0].fromSide; delete doc.edges[0].toSide; delete doc.edges[0].toEnd
    expect(toFlow(doc).edges[0]).toMatchObject({ sourceHandle: 'source-bottom', targetHandle: 'target-top' })
    expect(toFlow(doc).edges[0].markerEnd).toBeDefined()
  })
  it('紫色僅 UI 替換，原值不變', () => {
    expect(canvasColor('6')).toBe('#d49b27')
    expect(canvasColor('#123456')).toBe('#123456')
    expect(canvasColor('1')).toBe('#e05252')
  })
})
