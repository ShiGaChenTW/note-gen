export type Side = 'top' | 'right' | 'bottom' | 'left'
export interface CanvasNode {
  id: string; type: 'text' | 'file' | 'link' | 'group'
  x: number; y: number; width: number; height: number; color?: string
  text?: string; file?: string; subpath?: string; url?: string
  label?: string; background?: string; backgroundStyle?: string
  extra: Record<string, unknown>
}
export interface CanvasEdge {
  id: string; fromNode: string; toNode: string; fromSide?: Side; toSide?: Side
  fromEnd?: 'none' | 'arrow'; toEnd?: 'none' | 'arrow'; color?: string; label?: string
  extra: Record<string, unknown>
}
export interface CanvasDocument { nodes: CanvasNode[]; edges: CanvasEdge[]; extra: Record<string, unknown> }
const nodeKeys = ['id', 'type', 'x', 'y', 'width', 'height', 'color', 'text', 'file', 'subpath', 'url', 'label', 'background', 'backgroundStyle']
const edgeKeys = ['id', 'fromNode', 'toNode', 'fromSide', 'toSide', 'fromEnd', 'toEnd', 'color', 'label']
const sides = ['top', 'right', 'bottom', 'left']
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function unpack(value: Record<string, unknown>, keys: string[]) {
  return { ...Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key))), extra: Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key))) }
}
export function parseCanvas(text: string): { doc: CanvasDocument | null; errors: string[] } {
  try {
    const data: unknown = JSON.parse(text)
    if (!object(data) || data.nodes !== undefined && !Array.isArray(data.nodes) || data.edges !== undefined && !Array.isArray(data.edges)) throw new Error('nodes / edges')
    data.nodes ??= []; data.edges ??= []
    const ids = new Set<string>()
    const validColor = (v: unknown) => v === undefined || typeof v === 'string' && /^(?:[1-6]|#[0-9a-fA-F]{6})$/.test(v)
    for (const n of data.nodes as unknown[]) {
      if (!object(n) || typeof n.id !== 'string' || !n.id || ids.has(n.id) || !['text', 'file', 'link', 'group'].includes(String(n.type)) || !['x', 'y', 'width', 'height'].every(k => typeof n[k] === 'number' && Number.isInteger(n[k])) || Number(n.width) <= 0 || Number(n.height) <= 0 || !validColor(n.color)) throw new Error('node')
      ids.add(n.id)
      const required = ({ text: 'text', file: 'file', link: 'url' } as Record<string, string>)[String(n.type)]
      if (required && typeof n[required] !== 'string') throw new Error('node.' + required)
      for (const key of ['text', 'file', 'subpath', 'url', 'label', 'background', 'backgroundStyle']) if (n[key] !== undefined && typeof n[key] !== 'string') throw new Error('node.' + key)
      if (n.backgroundStyle !== undefined && !['cover', 'ratio', 'repeat'].includes(String(n.backgroundStyle))) throw new Error('backgroundStyle')
    }
    const edgeIds = new Set<string>()
    for (const e of data.edges as unknown[]) {
      if (!object(e) || typeof e.id !== 'string' || !e.id || edgeIds.has(e.id) || typeof e.fromNode !== 'string' || typeof e.toNode !== 'string' || !ids.has(e.fromNode) || !ids.has(e.toNode) || !validColor(e.color)) throw new Error('edge')
      edgeIds.add(e.id)
      for (const key of ['fromSide', 'toSide']) if (e[key] !== undefined && !sides.includes(String(e[key]))) throw new Error(key)
      for (const key of ['fromEnd', 'toEnd']) if (e[key] !== undefined && !['none', 'arrow'].includes(String(e[key]))) throw new Error(key)
      if (e.label !== undefined && typeof e.label !== 'string') throw new Error('edge.label')
    }
    return { doc: { nodes: (data.nodes as Record<string, unknown>[]).map(n => unpack(n, nodeKeys) as unknown as CanvasNode), edges: (data.edges as Record<string, unknown>[]).map(e => unpack(e, edgeKeys) as unknown as CanvasEdge), extra: unpack(data, ['nodes', 'edges']).extra }, errors: [] }
  } catch (error) { return { doc: null, errors: [error instanceof Error ? error.message : String(error)] } }
}
function pack(item: { extra: Record<string, unknown> }) { const { extra, ...known } = item; return { ...known, ...extra } }
function dataOf(doc: CanvasDocument) { return { nodes: doc.nodes.map(pack), edges: doc.edges.map(pack), ...doc.extra } }
// 未修改（包括修改後還原）時沿用完整原文；實際改動才套用 Obsidian 的縮排格式。
export function serializeCanvas(doc: CanvasDocument, original?: string): string {
  const data = dataOf(doc)
  if (original !== undefined) {
    const parsed = parseCanvas(original).doc
    if (parsed && JSON.stringify(dataOf(parsed)) === JSON.stringify(data)) return original
  }
  return JSON.stringify(data, null, '\t') + '\n'
}
