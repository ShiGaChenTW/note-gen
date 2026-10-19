import type { ElkNode } from 'elkjs/lib/elk.bundled.js'
import { noteKeyOf } from '@/lib/markdown/wikilink'
import type { IndexedNote } from './index-note'
import { resolveIndexedLink } from './links'

export interface GraphNode { id: string; label: string; path: string | null; distance: number; folder: string }
export interface GraphEdge { source: string; target: string }
export interface LocalGraph { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export const graphFolder = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** 以無向距離選取鄰居，輸出仍保留原始連結方向。 */
export function buildLocalGraph(centerPath: string, notes: Iterable<IndexedNote>, { depth, limit = 150 }: { depth: 1 | 2; limit?: number }): LocalGraph {
  const all = [...notes].sort((a, b) => compare(a.path, b.path))
  const paths = all.map(note => note.path)
  const center = paths.find(path => path.toLowerCase() === centerPath.toLowerCase()) ?? centerPath
  const nodes = new Map<string, Omit<GraphNode, 'distance'>>()
  const addNote = (path: string) => nodes.set(path, { id: path, label: noteKeyOf(path), path, folder: graphFolder(path) })
  addNote(center)
  all.forEach(note => addNote(note.path))
  const edges = new Map<string, GraphEdge>()
  const neighbors = new Map<string, Set<string>>()
  for (const note of all) for (const link of note.links) {
    const resolved = resolveIndexedLink(link, paths, note.path)
    const target = resolved ?? 'unresolved:' + link.target
    if (target === note.path) continue
    if (!resolved) nodes.set(target, { id: target, label: noteKeyOf(link.target), path: null, folder: '' })
    edges.set(JSON.stringify([note.path, target]), { source: note.path, target })
    for (const [a, b] of [[note.path, target], [target, note.path]]) {
      if (!neighbors.has(a)) neighbors.set(a, new Set())
      neighbors.get(a)!.add(b)
    }
  }
  const distances = new Map([[center, 0]])
  const queue = [center]
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], distance = distances.get(id)!
    if (distance >= depth || nodes.get(id)?.path === null) continue
    for (const neighbor of neighbors.get(id) ?? []) if (!distances.has(neighbor)) {
      distances.set(neighbor, distance + 1)
      queue.push(neighbor)
    }
  }
  const selected = [...distances].map(([id, distance]) => ({ ...nodes.get(id)!, distance }))
    .sort((a, b) => a.distance - b.distance || compare(a.id, b.id))
  const count = Math.max(1, Math.floor(limit))
  const visible = selected.slice(0, count)
  const ids = new Set(visible.map(node => node.id))
  return { nodes: visible, edges: [...edges.values()].filter(edge => ids.has(edge.source) && ids.has(edge.target))
    .sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target)), truncated: selected.length > count }
}

export type GraphLayout = (graph: ElkNode) => Promise<ElkNode>
/** 預設使用 bundled ELK；注入函式時不載入佈局引擎。 */
export async function layoutLocalGraph(graph: LocalGraph, layout?: GraphLayout): Promise<Map<string, { x: number; y: number }>> {
  if (!graph.nodes.length) return new Map()
  if (!layout) {
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
    const elk = new ELK()
    layout = input => elk.layout(input)
  }
  const result = await layout({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '40' },
    children: graph.nodes.map(node => ({ id: node.id, width: 160, height: 48 })),
    edges: graph.edges.map((edge, index) => ({ id: String(index), sources: [edge.source], targets: [edge.target] })) })
  return new Map(result.children?.map(node => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
}
