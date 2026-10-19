/** Phase 2：連結解析與雙向查詢，純函式、無 I/O。 */
import { noteKeyOf, resolveWikilinkTarget } from '@/lib/markdown/wikilink'
import type { IndexedLink, IndexedNote } from './index-note'

export type BacklinkRef = IndexedLink & { sourcePath: string }
export type OutgoingLink = IndexedLink & { resolved: string | null }

export function resolveIndexedLink(link: IndexedLink, notePaths: Iterable<string>, sourcePath: string): string | null {
  if (link.kind === 'wikilink') return resolveWikilinkTarget(link.target, notePaths, sourcePath)
  return [...notePaths].find(path => path.toLowerCase() === link.target.toLowerCase()) ?? null
}

export function collectBacklinks(targetPath: string, notes: Iterable<IndexedNote>): BacklinkRef[] {
  const all = [...notes]
  const paths = all.map(note => note.path)
  const refs: BacklinkRef[] = []
  for (const note of all) {
    if (note.path.toLowerCase() === targetPath.toLowerCase()) continue
    for (const link of note.links) {
      if (resolveIndexedLink(link, paths, note.path)?.toLowerCase() === targetPath.toLowerCase()) {
        refs.push({ ...link, sourcePath: note.path })
      }
    }
  }
  return refs.sort((a, b) => a.sourcePath === b.sourcePath ? a.line - b.line : a.sourcePath < b.sourcePath ? -1 : 1)
}

export function collectOutgoingLinks(path: string, notes: Iterable<IndexedNote>): OutgoingLink[] {
  const all = [...notes]
  const source = all.find(note => note.path === path)
  const paths = all.map(note => note.path)
  return source?.links.map(link => ({ ...link, resolved: resolveIndexedLink(link, paths, path) })) ?? []
}

/**
 * `resolveWikilinkTarget` 每次都會掃過全部路徑。這裡把同一組路徑預先做成對照表，
 * 規則與該函式相同（wikilink.ts 不能改）。對照表的路徑順序就是「第一個命中」的順序。
 */
export interface LinkHit {
  path: string
  index: number
}

export interface LinkSuffixHit {
  path: string
  md: boolean
}

export interface LinkLookup {
  /** 小寫完整路徑 → 迭代中第一個正規化路徑 */
  byPath: Map<string, LinkHit>
  /** 小寫筆記名 → 依迭代順序的 `.md`（沒有斜線、沒有副檔名的查詢） */
  byName: Map<string, string[]>
  /** 去掉 `.md` 的小寫完整路徑 → 第一個 `.md`（只給省略副檔名的查詢） */
  byStem: Map<string, LinkHit>
  /** 斜線之後的小寫後綴 → 路徑（附件與帶副檔名的筆記） */
  bySuffix: Map<string, LinkSuffixHit[]>
  /** markdown 連結：原始路徑小寫 → 第一個原始路徑 */
  byLower: Map<string, string>
}

export interface VaultLinkIndex {
  /** 鍵是解析後路徑的小寫 */
  backlinks: Map<string, BacklinkRef[]>
  /** 鍵是筆記路徑原文 */
  outgoing: Map<string, OutgoingLink[]>
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/')
}

function folderOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path)
}

function hasExtension(path: string): boolean {
  return /\.[a-z0-9]+$/i.test(path)
}

function earlier(left: LinkHit | undefined, right: LinkHit | undefined): string | null {
  if (!left) return right?.path ?? null
  if (!right) return left.path
  return left.index <= right.index ? left.path : right.path
}

/** 同資料夾優先，其次路徑較短，再來 localeCompare；平手留迭代中較早的。 */
function pickName(candidates: readonly string[], sourceFolder: string): string | null {
  if (candidates.length === 0) return null
  let best = candidates[0]
  for (let index = 1; index < candidates.length; index++) {
    const candidate = candidates[index]
    const candidateSame = folderOf(candidate) === sourceFolder ? 0 : 1
    const bestSame = folderOf(best) === sourceFolder ? 0 : 1
    if (candidateSame !== bestSame) {
      if (candidateSame < bestSame) best = candidate
      continue
    }
    if (candidate.length !== best.length) {
      if (candidate.length < best.length) best = candidate
      continue
    }
    if (candidate.localeCompare(best) < 0) best = candidate
  }
  return best
}

export function buildLinkLookup(paths: Iterable<string>): LinkLookup {
  const byPath = new Map<string, LinkHit>()
  const byName = new Map<string, string[]>()
  const byStem = new Map<string, LinkHit>()
  const bySuffix = new Map<string, LinkSuffixHit[]>()
  const byLower = new Map<string, string>()
  let index = 0
  for (const original of paths) {
    const path = normalizeRelPath(original)
    const lower = path.toLowerCase()
    if (!byPath.has(lower)) byPath.set(lower, { path, index })
    const md = isMarkdownPath(path)
    if (md) {
      const stem = lower.slice(0, -3)
      if (!byStem.has(stem)) byStem.set(stem, { path, index })
      const key = noteKeyOf(path).toLowerCase()
      const names = byName.get(key)
      if (names) names.push(path)
      else byName.set(key, [path])
    }
    let slash = lower.indexOf('/')
    while (slash >= 0) {
      const suffix = lower.slice(slash + 1)
      const hits = bySuffix.get(suffix)
      const hit = { path, md }
      if (hits) hits.push(hit)
      else bySuffix.set(suffix, [hit])
      slash = lower.indexOf('/', slash + 1)
    }
    const rawLower = original.toLowerCase()
    if (!byLower.has(rawLower)) byLower.set(rawLower, original)
    index++
  }
  return { byPath, byName, byStem, bySuffix, byLower }
}

export function resolveWikilinkTargetWithLookup(target: string, lookup: LinkLookup, sourcePath = ''): string | null {
  const wanted = normalizeRelPath(target.trim())
  if (!wanted) return sourcePath || null
  const wantedLower = wanted.toLowerCase()
  const hasExt = hasExtension(wanted)
  const exactPath = earlier(lookup.byPath.get(wantedLower), hasExt ? undefined : lookup.byStem.get(wantedLower))
  if (exactPath) return exactPath

  const sourceFolder = folderOf(normalizeRelPath(sourcePath))
  if (!hasExt && !wanted.includes('/')) {
    return pickName(lookup.byName.get(noteKeyOf(wanted).toLowerCase()) ?? [], sourceFolder)
  }
  if (!hasExt) return null
  const markdown = isMarkdownPath(wanted)
  const candidates: string[] = []
  for (const hit of lookup.bySuffix.get(wantedLower) ?? []) {
    if (hit.md === markdown) candidates.push(hit.path)
  }
  return pickName(candidates, sourceFolder)
}

export function resolveIndexedLinkWithLookup(link: IndexedLink, lookup: LinkLookup, sourcePath: string): string | null {
  if (link.kind === 'wikilink') return resolveWikilinkTargetWithLookup(link.target, lookup, sourcePath)
  return lookup.byLower.get(link.target.toLowerCase()) ?? null
}

function compareBacklink(left: BacklinkRef, right: BacklinkRef): number {
  return left.sourcePath === right.sourcePath ? left.line - right.line : left.sourcePath < right.sourcePath ? -1 : 1
}

/** 每個連結只解析一次，順便做出反向連結與連出。`lookup` 的路徑順序要與 `notes` 一致。 */
export function buildVaultLinkIndex(notes: Iterable<IndexedNote>, lookup: LinkLookup): VaultLinkIndex {
  const backlinks = new Map<string, BacklinkRef[]>()
  const outgoing = new Map<string, OutgoingLink[]>()
  for (const note of notes) {
    const resolvedLinks = note.links.map(link => {
      const resolved = resolveIndexedLinkWithLookup(link, lookup, note.path)
      if (resolved && note.path.toLowerCase() !== resolved.toLowerCase()) {
        const ref: BacklinkRef = { ...link, sourcePath: note.path }
        const key = resolved.toLowerCase()
        const bucket = backlinks.get(key)
        if (bucket) bucket.push(ref)
        else backlinks.set(key, [ref])
      }
      return { ...link, resolved }
    })
    outgoing.set(note.path, resolvedLinks)
  }
  for (const bucket of backlinks.values()) bucket.sort(compareBacklink)
  return { backlinks, outgoing }
}
