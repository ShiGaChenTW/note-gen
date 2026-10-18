/**
 * Phase 2（L1–L3）共用：Obsidian `[[wikilink]]` 的解析與目標解析。純函式、無 I/O。
 *
 * 支援 `[[Note]]`、`[[Note|別名]]`、`[[Note\|別名]]`（表格內）、`[[Note#標題]]`、
 * `[[Note#^blockid]]`、`[[#標題]]`（本篇）、`[[folder/Note]]`、`[[Note.md]]`、`![[嵌入]]`。
 * 目標解析採 Obsidian 預設「shortest path when possible」：先比完整相對路徑，
 * 再比檔名（不分大小寫）；多個同名時先選同資料夾，再選路徑最短者。
 */

export interface Wikilink {
  /** 原始字串，含 `[[ ]]`（嵌入時含前面的 `!`），寫回時必須一字不差 */
  raw: string
  /** `#` 前的目標；`[[#標題]]` 時為空字串（指本篇） */
  target: string
  /** `#` 後的標題；`#^id` 時為空字串 */
  heading: string
  /** `#^` 後的 block id */
  blockId: string
  /** `|` 後的顯示文字；沒有時為空字串 */
  alias: string
  /** `![[ ]]` */
  embed: boolean
}

export interface WikilinkOccurrence extends Wikilink {
  /** 0 起算、對整份內容 split('\n') 的行號 */
  line: number
  /** 在該行的字元起點（raw 的第一個字元，嵌入時是 `!`） */
  column: number
}

const INNER_RE = /^(?:!)?\[\[([^\]\n]*?)\]\]$/

/** 解析單一 `[[...]]` 字串；不是合法 wikilink 時回傳 null。 */
export function parseWikilink(raw: string): Wikilink | null {
  const m = INNER_RE.exec(raw)
  if (!m) return null
  const inner = m[1]
  if (inner.includes('[[') || inner.includes(']]')) return null

  // 別名：`|` 或表格內轉義的 `\|`，只認第一個
  let alias = ''
  let rest = inner
  const pipe = inner.search(/\\?\|/)
  if (pipe >= 0) {
    const sep = inner[pipe] === '\\' ? 2 : 1
    rest = inner.slice(0, pipe)
    alias = inner.slice(pipe + sep).trim()
  }

  let heading = ''
  let blockId = ''
  let target = rest
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    target = rest.slice(0, hash)
    const anchor = rest.slice(hash + 1).trim()
    if (anchor.startsWith('^')) blockId = anchor.slice(1).trim()
    else heading = anchor
  }
  target = target.trim()
  if (!target && !heading && !blockId) return null

  return { raw, target, heading, blockId, alias, embed: raw.startsWith('!') }
}

/** 顯示文字：別名 > 目標檔名（不含路徑）> `#標題`。 */
export function wikilinkDisplayText(link: Wikilink): string {
  if (link.alias) return link.alias
  if (link.target) {
    const name = noteKeyOf(link.target)
    return link.heading ? `${name} > ${link.heading}` : name
  }
  return link.heading ? link.heading : `^${link.blockId}`
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/
const CANDIDATE_RE = /!?\[\[[^\]\n]*?\]\]/g

/** 把一行中的 inline code（成對反引號）位置找出來，避免把 `` `[[x]]` `` 當成連結。 */
function codeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  const re = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) spans.push([m.index, m.index + m[0].length])
  return spans
}

/** 找出內容中所有 wikilink（含嵌入），跳過 fenced code 與 inline code。 */
export function findWikilinks(content: string): WikilinkOccurrence[] {
  const out: WikilinkOccurrence[] = []
  const lines = content.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    const fenceMatch = line.match(FENCE_RE)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue
    if (!line.includes('[[')) continue

    const spans = codeSpans(line)
    CANDIDATE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CANDIDATE_RE.exec(line))) {
      const start = m.index
      if (spans.some(([a, b]) => start >= a && start < b)) continue
      const parsed = parseWikilink(m[0])
      if (!parsed) continue
      out.push({ ...parsed, line: i, column: start })
    }
  }
  return out
}

/** 去掉路徑與 `.md`，得到 Obsidian 用來比對的「筆記名稱」。 */
export function noteKeyOf(pathOrTarget: string): string {
  const name = pathOrTarget.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
  return name.replace(/\.md$/i, '')
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/')
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path)
}

/**
 * 把 wikilink 目標解析成 vault 內的相對路徑；找不到時回傳 null。
 * @param target  `[[ ]]` 內 `#`、`|` 之前的部分（可含資料夾、可含 `.md`）
 * @param paths   vault 內所有檔案的相對路徑（至少要含所有 `.md`）
 * @param sourcePath  含這個連結的筆記路徑；空字串時不考慮同資料夾優先
 */
export function resolveWikilinkTarget(
  target: string,
  paths: Iterable<string>,
  sourcePath = '',
): string | null {
  const wanted = normalizeRelPath(target.trim())
  if (!wanted) return sourcePath || null
  const wantedLower = wanted.toLowerCase()
  const wantedKey = noteKeyOf(wanted).toLowerCase()
  const hasExt = /\.[a-z0-9]+$/i.test(wanted)
  const sourceFolder = folderOf(normalizeRelPath(sourcePath))

  let exact: string | null = null
  const byName: string[] = []
  for (const original of paths) {
    const path = normalizeRelPath(original)
    const lower = path.toLowerCase()
    // 1. 完整相對路徑（可省略 .md）
    if (lower === wantedLower || (!hasExt && lower === `${wantedLower}.md`)) {
      exact = exact ?? path
      continue
    }
    // 2. 只比檔名：`.md` 用名稱比，其他附件要連副檔名一起比
    const md = isMarkdownPath(path)
    if (md && !hasExt && noteKeyOf(path).toLowerCase() === wantedKey && !wanted.includes('/')) byName.push(path)
    else if (!md && hasExt && lower.endsWith(`/${wantedLower}`)) byName.push(path)
    else if (md && hasExt && isMarkdownPath(wanted) && lower.endsWith(`/${wantedLower}`)) byName.push(path)
  }
  if (exact) return exact
  if (byName.length === 0) return null
  if (byName.length === 1) return byName[0]

  byName.sort((a, b) => {
    const aSame = folderOf(a) === sourceFolder ? 0 : 1
    const bSame = folderOf(b) === sourceFolder ? 0 : 1
    if (aSame !== bSame) return aSame - bSame
    if (a.length !== b.length) return a.length - b.length
    return a.localeCompare(b)
  })
  return byName[0]
}

/**
 * 產生寫進 `[[ ]]` 的目標字串（Obsidian「shortest path when possible」）：
 * 檔名在 vault 內唯一時只寫檔名，否則寫完整相對路徑（不含 .md）。
 */
export function wikilinkTargetFor(targetPath: string, paths: Iterable<string>): string {
  const path = normalizeRelPath(targetPath)
  const key = noteKeyOf(path)
  const keyLower = key.toLowerCase()
  let count = 0
  for (const p of paths) {
    if (isMarkdownPath(p) && noteKeyOf(p).toLowerCase() === keyLower) count++
  }
  return count <= 1 ? key : path.replace(/\.md$/i, '')
}
