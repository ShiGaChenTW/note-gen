import { describe, it, expect } from 'vitest'
import { parseCanvas, serializeCanvas } from './format'
const node = { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100, text: '原文\n **文字**', plugin: { a: 1 } }
describe('JSON Canvas 格式', () => {
  it.each(['\n', '\r\n'])('未修改原文完整往返 %j', newline => {
    const original = JSON.stringify({ custom: true, nodes: [node], edges: [] }, null, 2).replace(/\n/g, newline) + newline
    const { doc, errors } = parseCanvas(original)
    expect(errors).toEqual([])
    expect(doc!.nodes[0].extra).toEqual({ plugin: { a: 1 } })
    expect(serializeCanvas(doc!, original)).toBe(original)
  })
  it('修改座標保留其他節點、未知欄位與順序，使用 Tab 與結尾換行', () => {
    const original = JSON.stringify({ nodes: [node, { ...node, id: 'b' }], edges: [], custom: 42 })
    const doc = parseCanvas(original).doc!
    doc.nodes[0].x = 30
    const output = serializeCanvas(doc, original)
    expect(output).toContain('\n\t"nodes"')
    expect(output.endsWith('\n')).toBe(true)
    const value = JSON.parse(output)
    expect(value.nodes[1]).toEqual({ ...node, id: 'b' })
    expect(value.nodes[0].text).toBe(node.text)
    expect(value.nodes[0].plugin).toEqual(node.plugin)
    expect(value.custom).toBe(42)
    doc.nodes[0].x = 0
    expect(serializeCanvas(doc, original)).toBe(original)
  })
  it('四種節點、所有邊屬性可往返', () => {
    const data = { nodes: [node, { ...node, id: 'f', type: 'file', file: 'a.md', subpath: '#標題' }, { ...node, id: 'l', type: 'link', url: 'https://example.com' }, { ...node, id: 'g', type: 'group', label: '群組', background: 'a.png', backgroundStyle: 'cover' }], edges: [{ id: 'e', fromNode: 'a', toNode: 'f', fromSide: 'left', toSide: 'right', fromEnd: 'arrow', toEnd: 'none', label: '邊', color: '6', custom: 1 }] }
    const original = JSON.stringify(data)
    expect(serializeCanvas(parseCanvas(original).doc!, original)).toBe(original)
  })
  it.each([
    { ...node, x: 0.5 }, { ...node, width: 0 }, { ...node, color: '7' },
    { ...node, type: 'file', file: 1 }, { ...node, subpath: 1 },
    { ...node, type: 'group', backgroundStyle: 'invalid' },
  ])('拒絕無效節點 %j', invalid => {
    expect(parseCanvas(JSON.stringify({ nodes: [invalid] })).doc).toBeNull()
  })
  it.each([
    { fromSide: 'middle' }, { toSide: 'middle' }, { fromEnd: 'circle' },
    { toEnd: 'circle' }, { color: '7' }, { label: 42 }, { toNode: 'missing' },
    { fromNode: 1 },
  ])('拒絕無效邊 %j', invalid => {
    expect(parseCanvas(JSON.stringify({ nodes: [node], edges: [{ id: 'e', fromNode: 'a', toNode: 'a', ...invalid }] })).doc).toBeNull()
  })
  it('拒絕重複節點與邊 ID', () => {
    expect(parseCanvas(JSON.stringify({ nodes: [node, node] })).doc).toBeNull()
    const edge = { id: 'e', fromNode: 'a', toNode: 'a' }
    expect(parseCanvas(JSON.stringify({ nodes: [node], edges: [edge, edge] })).doc).toBeNull()
  })
  it.each(['{}', '{"nodes":[]}', '{"edges":[]}'])('可省略頂層陣列 %s', original => {
    expect(serializeCanvas(parseCanvas(original).doc!, original)).toBe(original)
  })
  it.each(['', '{', '[]', '{"nodes":[{}],"edges":[]}', '{"nodes":[],"edges":[{}]}'])('拒絕無效格式 %s', text => {
    expect(parseCanvas(text).errors.length).toBeGreaterThan(0)
    expect(parseCanvas(text).doc).toBeNull()
  })
})
