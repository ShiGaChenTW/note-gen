/** Phase 2：連結解析與雙向查詢，純函式、無 I/O。 */
import { resolveWikilinkTarget } from '@/lib/markdown/wikilink'
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
