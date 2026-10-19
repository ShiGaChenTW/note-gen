/**
 * Phase 2-2 L7：筆記改名／搬動後，改寫指向它的 `[[wikilink]]` 與相對路徑 markdown 連結。
 * 純函式、無 I/O；I/O 與 UI 在 `src/lib/wikilink-rename.ts` 與 `src/app/core/main/link-rewrite/`。
 *
 * 規則照 Obsidian 預設「shortest path when possible」：
 * - 每個 wikilink 先算出搬動後應指向的檔案；原本的文字從新位置仍解析到同一檔案就一字不動，
 *   否則新目標用 `wikilinkTargetFor(newPath, pathsAfter)`（唯一時只寫檔名，同名時寫完整路徑）；
 *   這同時涵蓋目標搬走、部分路徑失效、改名造成同名讓原文字指到別篇等情況；
 * - 被搬動的筆記自己的相對路徑 markdown 連結，以新位置重算；
 * - `#標題`、`#^block`、`|別名`（含表格內 `\|`）、`!` 嵌入、原本的空白與編碼都保留；沒變的連結一字不動。
 */

import { findWikilinks, noteKeyOf, resolveWikilinkTarget, wikilinkTargetFor } from '@/lib/markdown/wikilink'
import type { IndexedNote } from '@/lib/vault-index/index-note'

/** 與上游 `WorkspacePathMove` 同形；資料夾搬動用前綴對應。 */
export interface PathMove {
  sourcePath: string
  targetPath: string
}

export interface RewriteLinksInput {
  content: string
  /** 來源筆記搬動前的路徑 */
  sourcePathBefore: string
  /** 來源筆記搬動後的路徑（沒搬動時與 before 相同） */
  sourcePathAfter: string
  moves: PathMove[]
  /** 搬動前 vault 內所有筆記路徑 */
  pathsBefore: Iterable<string>
  /** 搬動後 vault 內所有筆記路徑 */
  pathsAfter: Iterable<string>
}

export interface RewriteLinksResult {
  content: string
  /** 實際改寫的連結數 */
  count: number
}

export function normalizeVaultPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

/** 去掉空的或原地不動的搬動，較長的 sourcePath 優先（子資料夾先於父資料夾）。 */
export function normalizeMoves(moves: PathMove[]): PathMove[] {
  return moves
    .map(move => ({ sourcePath: normalizeVaultPath(move.sourcePath), targetPath: normalizeVaultPath(move.targetPath) }))
    .filter(move => move.sourcePath && move.targetPath && move.sourcePath !== move.targetPath)
    .sort((a, b) => b.sourcePath.length - a.sourcePath.length)
}

/** 路徑等於 `sourcePath` 或在它之下就換成 `targetPath` 前綴，否則原樣回傳。 */
export function mapMovedPath(path: string, moves: PathMove[]): string {
  const normalized = normalizeVaultPath(path)
  for (const move of normalizeMoves(moves)) {
    if (normalized === move.sourcePath) return move.targetPath
    if (normalized.startsWith(`${move.sourcePath}/`)) return `${move.targetPath}${normalized.slice(move.sourcePath.length)}`
  }
  return normalized
}

/** `mapMovedPath` 的反向：索引若已被 watcher 更新成新路徑，換回搬動前的路徑。 */
export function unmapMovedPath(path: string, moves: PathMove[]): string {
  return mapMovedPath(path, moves.map(move => ({ sourcePath: move.targetPath, targetPath: move.sourcePath })))
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/**
 * 補上 2-1 缺的部分路徑解析：先照 `resolveWikilinkTarget`；解析不到且目標含 `/` 時，
 * 再試「來源資料夾/目標」（Obsidian「Relative path to file」格式）。
 */
export function resolveLinkTarget(target: string, paths: Iterable<string>, sourcePath: string): string | null {
  const list = Array.isArray(paths) ? paths : [...paths]
  const direct = resolveWikilinkTarget(target, list, sourcePath)
  if (direct !== null) return direct
  const wanted = normalizeVaultPath(target)
  const folder = folderOf(normalizeVaultPath(sourcePath))
  if (!wanted.includes('/') || !folder) return null
  return resolveWikilinkTarget(`${folder}/${wanted}`, list, sourcePath)
}

interface Edit {
  start: number
  end: number
  text: string
}

/** 每行在整份內容的起始 offset（以 `\n` 切行，`\r` 留在行尾）。 */
function lineOffsets(content: string): number[] {
  const offsets = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

/** 把 fenced code 與 inline code 換成等長空白，位置不變。 */
function maskCode(content: string): string {
  let fence: string | null = null
  const masked = content.split('\n').map(line => {
    const bare = line.replace(/\r$/, '')
    const match = bare.match(/^\s*(`{3,}|~{3,})/)
    if (match) {
      if (fence === null) fence = match[1]
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null
      return line.replace(/[^\r]/g, ' ')
    }
    if (fence !== null) return line.replace(/[^\r]/g, ' ')
    return line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, span => ' '.repeat(span.length))
  })
  return masked.join('\n')
}

/** 把 `[[ ]]` 內的目標換掉，`!`、空白、`#標題`、`|別名`（含 `\|`）都照舊。 */
function replaceWikilinkTarget(raw: string, newTarget: string): string {
  const open = raw.indexOf('[[') + 2
  const inner = raw.slice(open, raw.length - 2)
  const pipe = inner.search(/\\?\|/)
  const rest = pipe >= 0 ? inner.slice(0, pipe) : inner
  const hash = rest.indexOf('#')
  const targetRaw = hash >= 0 ? rest.slice(0, hash) : rest
  const leading = targetRaw.match(/^\s*/)![0]
  const trailing = targetRaw.match(/\s*$/)![0]
  return `${raw.slice(0, open)}${leading}${newTarget}${trailing}${rest.slice(targetRaw.length)}${inner.slice(rest.length)}]]`
}

function joinRelative(folder: string, relative: string): string | null {
  const parts = folder ? folder.split('/') : []
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** 從 `fromFolder` 指到 `toPath` 的相對路徑（Obsidian 寫法，上一層用 `../`）。 */
function relativeTo(fromFolder: string, toPath: string): string {
  const from = fromFolder ? fromFolder.split('/') : []
  const to = toPath.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  return [...Array<string>(from.length - common).fill('..'), ...to.slice(common)].join('/')
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** 原本有 `%xx` 就整段照 Obsidian 編碼；沒有就只處理會打斷 `( )` 的空白與括號（`<...>` 內不用）。 */
function encodeLike(path: string, original: string, wrapped: boolean): string {
  if (/%[\da-f]{2}/i.test(original)) return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  if (wrapped) return path
  return path.replace(/[ ()]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

const MARKDOWN_LINK_RE = /(?<!!)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|[/#\\])/i

/**
 * 改寫一篇筆記內受搬動影響的連結。
 * 沒受影響的連結與其他所有文字一字不動；完全沒改時回傳原字串與 `count 0`。
 */
export function rewriteLinksForMoves(input: RewriteLinksInput): RewriteLinksResult {
  const moves = normalizeMoves(input.moves)
  if (moves.length === 0) return { content: input.content, count: 0 }
  const { content } = input
  const sourceBefore = normalizeVaultPath(input.sourcePathBefore)
  const sourceAfter = normalizeVaultPath(input.sourcePathAfter)
  const pathsBefore = [...input.pathsBefore].map(normalizeVaultPath)
  const pathsAfter = [...input.pathsAfter].map(normalizeVaultPath)
  const afterSet = new Set(pathsAfter.map(path => path.toLowerCase()))
  const offsets = lineOffsets(content)
  const edits: Edit[] = []

  // 1. wikilink（findWikilinks 已跳過 code；frontmatter 引號內的也算）
  for (const link of findWikilinks(content)) {
    if (!link.target) continue
    const resolvedBefore = resolveLinkTarget(link.target, pathsBefore, sourceBefore)
    if (resolvedBefore === null) continue
    const mappedTarget = mapMovedPath(resolvedBefore, moves)
    if (!afterSet.has(mappedTarget.toLowerCase())) continue
    // 原本的文字從新位置、用搬動後的路徑清單解析，仍指到同一個檔案就一字不動；
    // 否則（目標搬走、部分路徑失效、同名出現讓同資料夾優先指到別篇…）改成 shortest 寫法
    const resolvedAfter = resolveLinkTarget(link.target, pathsAfter, sourceAfter)
    if (resolvedAfter !== null && resolvedAfter.toLowerCase() === mappedTarget.toLowerCase()) continue
    const raw = replaceWikilinkTarget(link.raw, wikilinkTargetFor(mappedTarget, pathsAfter))
    if (raw === link.raw) continue
    const start = offsets[link.line] + link.column
    edits.push({ start, end: start + link.raw.length, text: raw })
  }

  // 2. markdown 連結 `[文字](目標)`：跳過圖片、外部網址、錨點、code
  const masked = maskCode(content)
  const beforeSet = new Map(pathsBefore.map(path => [path.toLowerCase(), path]))
  const sourceFolderBefore = folderOf(sourceBefore)
  const sourceFolderAfter = folderOf(sourceAfter)
  MARKDOWN_LINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MARKDOWN_LINK_RE.exec(masked))) {
    const wrapped = match[2] !== undefined
    const href = wrapped ? match[2] : match[3]
    const hash = href.indexOf('#')
    const pathPart = hash < 0 ? href : href.slice(0, hash)
    const fragment = hash < 0 ? '' : href.slice(hash)
    const decoded = decodePath(pathPart)
    if (!decoded || EXTERNAL_RE.test(decoded)) continue

    const relativeResolved = joinRelative(sourceFolderBefore, decoded)
    const rootResolved = normalizeVaultPath(decoded)
    // 與索引一致：先當成相對本篇資料夾；找不到但從 vault 根目錄找得到時，當成根目錄相對路徑
    const useRoot = (relativeResolved === null || !beforeSet.has(relativeResolved.toLowerCase()))
      && beforeSet.has(rootResolved.toLowerCase())
    const resolvedBefore = useRoot ? rootResolved : relativeResolved
    if (resolvedBefore === null) continue
    const resolvedAfter = mapMovedPath(resolvedBefore, moves)
    const nextRelative = useRoot ? resolvedAfter : relativeTo(sourceFolderAfter, resolvedAfter)
    if (nextRelative === decoded) continue

    const nextHref = `${encodeLike(nextRelative, pathPart, wrapped)}${fragment}`
    const hrefStart = match.index + match[0].indexOf(wrapped ? `<${href}>` : href, match[1].length + 2) + (wrapped ? 1 : 0)
    edits.push({ start: hrefStart, end: hrefStart + href.length, text: nextHref })
  }

  if (edits.length === 0) return { content, count: 0 }
  // 由後往前替換，避免位移
  edits.sort((a, b) => b.start - a.start)
  let next = content
  for (const edit of edits) next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`
  return { content: next, count: edits.length }
}

/**
 * 用索引預先篩出可能受影響的筆記路徑（連到被搬動檔案的、被搬動的筆記本身、
 * 連到「因改名而出現或消失同名」筆記的），避免全 vault 讀檔。
 * 掛載當下 watcher 可能還沒更新索引（索引仍是舊路徑），也可能已更新；
 * 這裡一律先把索引路徑換回搬動前的路徑，回傳的也是**搬動前**的路徑。
 */
export function collectLinkRewriteCandidates(moves: PathMove[], notes: Iterable<IndexedNote>): string[] {
  const normalized = normalizeMoves(moves)
  if (normalized.length === 0) return []
  const all = [...notes].map(note => ({ note, path: unmapMovedPath(note.path, normalized) }))
  const pathsBefore = all.map(item => item.path)
  // 檔名改變的搬動會讓同名筆記出現或消失，指向同名筆記的連結也可能要換寫法
  const renamedKeys = new Set<string>()
  for (const move of normalized) {
    const from = noteKeyOf(move.sourcePath).toLowerCase()
    const to = noteKeyOf(move.targetPath).toLowerCase()
    if (from !== to) renamedKeys.add(from).add(to)
  }

  const out: string[] = []
  for (const { note, path } of all) {
    if (mapMovedPath(path, normalized) !== path) {
      out.push(path)
      continue
    }
    const affected = note.links.some(link => {
      const resolved = link.kind === 'wikilink'
        ? resolveLinkTarget(link.target, pathsBefore, path)
        : pathsBefore.find(candidate => candidate.toLowerCase() === normalizeVaultPath(link.target).toLowerCase()) ?? null
      if (resolved === null) return false
      if (mapMovedPath(resolved, normalized) !== resolved) return true
      return link.kind === 'wikilink' && renamedKeys.has(noteKeyOf(resolved).toLowerCase())
    })
    if (affected) out.push(path)
  }
  return [...new Set(out)]
}
