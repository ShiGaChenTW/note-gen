import type { ElkNode } from 'elkjs/lib/elk.bundled.js'
import { noteKeyOf } from '@/lib/markdown/wikilink'
import type { IndexedNote } from './index-note'
import { buildLinkLookup, resolveIndexedLinkWithLookup } from './links'

export interface GraphNode { id: string; label: string; path: string | null; distance: number; folder: string }
export interface GraphEdge { source: string; target: string }
export interface LocalGraph { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export const graphFolder = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

interface GraphNodeSeed { id: string; label: string; path: string | null; folder: string }

interface Adjacency {
  paths: string[]
  nodes: Map<string, GraphNodeSeed>
  edges: Map<string, GraphEdge>
  neighbors: Map<string, Set<string>>
}

let adjacencyCache: { key: string, value: Adjacency } | null = null

/** 路徑與連結的指紋。同一個 revision、同一批筆記換中心時不用重解連結。 */
function hashNotes(notes: readonly IndexedNote[]): string {
  let left = 0x811c9dc5
  let right = 0x811c9dc5 ^ notes.length
  const mix = (hash: number, text: string): number => {
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
    return hash >>> 0
  }
  for (const note of notes) {
    left = mix(left, note.path)
    left = Math.imul(left ^ note.links.length, 0x01000193) >>> 0
    for (const link of note.links) {
      right = mix(right, link.target)
      right = mix(right, link.kind)
      right = mix(right, link.alias)
      right = mix(right, link.heading)
      right = Math.imul(right ^ link.line, 0x01000193) >>> 0
      right = Math.imul(right ^ (link.embed ? 1 : 0), 0x01000193) >>> 0
    }
  }
  return `${notes.length}:${left.toString(16)}:${right.toString(16)}`
}

function connect(neighbors: Map<string, Set<string>>, source: string, target: string): void {
  let forward = neighbors.get(source)
  if (!forward) neighbors.set(source, forward = new Set())
  forward.add(target)
  let backward = neighbors.get(target)
  if (!backward) neighbors.set(target, backward = new Set())
  backward.add(source)
}

function computeAdjacency(all: readonly IndexedNote[]): Adjacency {
  const paths = all.map(note => note.path)
  const lookup = buildLinkLookup(paths)
  const nodes = new Map<string, GraphNodeSeed>()
  for (const note of all) nodes.set(note.path, { id: note.path, label: noteKeyOf(note.path), path: note.path, folder: graphFolder(note.path) })
  const edges = new Map<string, GraphEdge>()
  const neighbors = new Map<string, Set<string>>()
  for (const note of all) for (const link of note.links) {
    const resolved = resolveIndexedLinkWithLookup(link, lookup, note.path)
    const target = resolved ?? 'unresolved:' + link.target
    if (target === note.path) continue
    if (!resolved) nodes.set(target, { id: target, label: noteKeyOf(link.target), path: null, folder: '' })
    edges.set(JSON.stringify([note.path, target]), { source: note.path, target })
    connect(neighbors, note.path, target)
  }
  return { paths, nodes, edges, neighbors }
}

function adjacencyFor(all: readonly IndexedNote[], revision: number | undefined): Adjacency {
  const key = `${revision ?? ''}:${hashNotes(all)}`
  if (adjacencyCache?.key === key) return adjacencyCache.value
  const value = computeAdjacency(all)
  adjacencyCache = { key, value }
  return value
}

/** 以無向距離選取鄰居，輸出仍保留原始連結方向。鄰接表依 revision 與筆記內容快取。 */
export function buildLocalGraph(centerPath: string, notes: Iterable<IndexedNote>, { depth, limit = 150, revision }: { depth: 1 | 2; limit?: number; revision?: number }): LocalGraph {
  const all = [...notes].sort((a, b) => compare(a.path, b.path))
  const adj = adjacencyFor(all, revision)
  const center = adj.paths.find(path => path.toLowerCase() === centerPath.toLowerCase()) ?? centerPath
  const nodes = adj.nodes.has(center)
    ? adj.nodes
    : new Map(adj.nodes).set(center, { id: center, label: noteKeyOf(center), path: center, folder: graphFolder(center) })
  const distances = new Map([[center, 0]])
  const queue = [center]
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], distance = distances.get(id)!
    if (distance >= depth || nodes.get(id)?.path === null) continue
    for (const neighbor of adj.neighbors.get(id) ?? []) if (!distances.has(neighbor)) {
      distances.set(neighbor, distance + 1)
      queue.push(neighbor)
    }
  }
  const selected = [...distances].map(([id, distance]) => ({ ...nodes.get(id)!, distance }))
    .sort((a, b) => a.distance - b.distance || compare(a.id, b.id))
  const count = Math.max(1, Math.floor(limit))
  const visible = selected.slice(0, count)
  const ids = new Set(visible.map(node => node.id))
  return { nodes: visible, edges: [...adj.edges.values()].filter(edge => ids.has(edge.source) && ids.has(edge.target))
    .sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target))
    .map(edge => ({ source: edge.source, target: edge.target })), truncated: selected.length > count }
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
