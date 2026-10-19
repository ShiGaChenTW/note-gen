/**
 * 筆記標籤樹。只讀索引裡的 `tags`，不解析 Markdown、不寫檔。
 * 比對不分大小寫；顯示字用傳入順序裡第一次出現的寫法。
 */

import type { IndexedNote } from './index-note'

export interface TagNode {
  /** 這一層的顯示名稱（保留第一次遇到的大小寫） */
  name: string
  /** 小寫比較鍵，巢狀以 `/` 連接，例如 `work/project` */
  fullPath: string
  /** 去重後的筆記數，含子標籤 */
  count: number
  children: TagNode[]
}

interface MutableNode {
  name: string
  fullPath: string
  notes: Set<string>
  children: Map<string, MutableNode>
}

/** 去前導 `#`、trim、轉小寫，並略過空的路徑段（`#/a`、`#a//b`）。 */
export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/u, '')
    .trim()
    .toLowerCase()
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .join('/')
}

function rawSegments(tag: string): string[] {
  return tag.trim().replace(/^#+/u, '').trim().split('/').map(segment => segment.trim()).filter(Boolean)
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0)
}

function compareNodes(a: TagNode, b: TagNode, by: 'name' | 'count'): number {
  if (by === 'count' && a.count !== b.count) return b.count - a.count
  return compareText(a.name, b.name) || compareText(a.fullPath, b.fullPath)
}

function freeze(nodes: Map<string, MutableNode>): TagNode[] {
  return [...nodes.values()].map(node => ({
    name: node.name,
    fullPath: node.fullPath,
    count: node.notes.size,
    children: freeze(node.children),
  }))
}

/** 依名稱排序的標籤樹。同一篇同時有父標籤與子標籤只算一次。 */
export function buildTagTree(notes: Iterable<IndexedNote>): TagNode[] {
  const roots = new Map<string, MutableNode>()
  for (const note of notes) {
    const counted = new Set<string>()
    for (const tag of note.tags) {
      let parent = roots
      let fullPath = ''
      for (const segment of rawSegments(tag)) {
        const key = segment.toLowerCase()
        fullPath = fullPath ? `${fullPath}/${key}` : key
        let node = parent.get(key)
        if (!node) {
          node = { name: segment, fullPath, notes: new Set(), children: new Map() }
          parent.set(key, node)
        }
        if (!counted.has(fullPath)) {
          node.notes.add(note.path)
          counted.add(fullPath)
        }
        parent = node.children
      }
    }
  }
  return sortTagTree(freeze(roots), 'name')
}

/** 這個標籤（預設含子標籤）的筆記路徑，依路徑排序。 */
export function collectNotesForTag(
  fullPath: string,
  notes: Iterable<IndexedNote>,
  options?: { includeNested?: boolean },
): string[] {
  const wanted = normalizeTag(fullPath)
  if (!wanted) return []
  const includeNested = options?.includeNested !== false
  const prefix = `${wanted}/`
  const found = new Set<string>()
  for (const note of notes) {
    const hit = note.tags.some(tag => {
      const path = normalizeTag(tag)
      return path === wanted || (includeNested && path.startsWith(prefix))
    })
    if (hit) found.add(note.path)
  }
  return [...found].sort(compareText)
}

/** 保留命中節點與祖先。空查詢回傳原本的樹。 */
export function filterTagTree(tree: TagNode[], query: string): TagNode[] {
  const key = normalizeTag(query)
  if (!key) return tree
  const visit = (node: TagNode): TagNode | null => {
    const children = node.children.map(visit).filter((child): child is TagNode => child !== null)
    const hit = node.fullPath.includes(key)
    if (!hit && children.length === 0) return null
    if (children.length === node.children.length && children.every((child, index) => child === node.children[index])) {
      return node
    }
    return { ...node, children }
  }
  return tree.map(visit).filter((node): node is TagNode => node !== null)
}

/** 排序並複製，不改動傳入的樹。數量由多到少，相同時再依名稱。 */
export function sortTagTree(tree: TagNode[], by: 'name' | 'count'): TagNode[] {
  const sorted = tree.map(node => ({ ...node, children: sortTagTree(node.children, by) }))
  sorted.sort((a, b) => compareNodes(a, b, by))
  return sorted
}
