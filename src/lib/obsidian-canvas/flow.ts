import { MarkerType, type Node, type Edge } from '@xyflow/react'
import { type CanvasDocument, type CanvasNode, serializeCanvas } from './format'
export type CanvasFlowNode = Node<{ node: CanvasNode }, 'canvas'>
export function canvasColor(color?: string): string | undefined {
  return ({ '1': '#e05252', '2': '#e58f40', '3': '#d6b83e', '4': '#52a76d', '5': '#43a7af', '6': '#d49b27' } as Record<string, string>)[color ?? ''] ?? color
}
export function toFlow(doc: CanvasDocument): { nodes: CanvasFlowNode[]; edges: Edge[] } {
  // JSON Canvas 使用絕對座標；以最小完整容器推導 xyflow 的父群組。
  const parents = new Map<string, CanvasNode>()
  for (const n of doc.nodes) {
    const parent = doc.nodes.filter(g => g.type === 'group' && g.id !== n.id && g.width * g.height > n.width * n.height && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    if (parent) parents.set(n.id, parent)
  }
  const depth = (n: CanvasNode): number => parents.has(n.id) ? 1 + depth(parents.get(n.id)!) : 0
  return {
    nodes: [...doc.nodes].sort((a, b) => depth(a) - depth(b)).map(n => {
      const parent = parents.get(n.id)
      return { id: n.id, type: 'canvas', position: { x: n.x - (parent?.x ?? 0), y: n.y - (parent?.y ?? 0) }, width: n.width, height: n.height, style: { width: n.width, height: n.height }, ...(parent ? { parentId: parent.id, extent: 'parent' as const } : {}), data: { node: n }, zIndex: doc.nodes.indexOf(n) }
    }),
    edges: doc.edges.map(e => ({ id: e.id, source: e.fromNode, target: e.toNode, sourceHandle: 'source-' + (e.fromSide ?? 'bottom'), targetHandle: 'target-' + (e.toSide ?? 'top'), label: e.label, style: { stroke: canvasColor(e.color) }, markerStart: e.fromEnd === 'arrow' ? { type: MarkerType.ArrowClosed } : undefined, markerEnd: e.toEnd !== 'none' ? { type: MarkerType.ArrowClosed } : undefined }))
  }
}
// 寫回時恢復絕對座標與原始陣列順序，不把 xyflow 的介面狀態寫入 vault。
export function fromFlow(doc: CanvasDocument, nodes: CanvasFlowNode[], edges: Edge[]): CanvasDocument {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const position = (n: CanvasFlowNode): { x: number; y: number } => {
    const parent = n.parentId && byId.get(n.parentId)
    const base = parent ? position(parent) : { x: 0, y: 0 }
    return { x: Math.round(n.position.x + base.x), y: Math.round(n.position.y + base.y) }
  }
  return { ...doc, nodes: doc.nodes.filter(n => byId.has(n.id)).map(n => {
    const flow = byId.get(n.id)!
    return { ...n, ...position(flow), width: Math.round(flow.width ?? n.width), height: Math.round(flow.height ?? n.height) }
  }), edges: doc.edges.filter(e => edges.some(flow => flow.id === e.id) && byId.has(e.fromNode) && byId.has(e.toNode)) }
}
export function mayReload(original: string, latest: string, dirty: boolean): 'reload' | 'keep' | 'conflict' {
  return latest === original ? 'keep' : dirty ? 'conflict' : 'reload'
}
export function guardedCanvasWrite(doc: CanvasDocument, original: string, latest: string): string {
  if (latest !== original) throw new Error('externalChange')
  return serializeCanvas(doc, original)
}
