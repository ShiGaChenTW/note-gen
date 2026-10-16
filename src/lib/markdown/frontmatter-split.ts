// Split a markdown document into its leading YAML frontmatter block and the body,
// without touching a single byte: `block + body === raw` always holds.
//
// Rules (same as Obsidian, and the large-document section splitter):
// - The first line (BOM ignored) must be `---`.
// - The block ends at the first later line that is `---` or `...`.
// - An unclosed `---` is not frontmatter (usually a thematic break).

export interface FrontmatterSplit {
  /** The frontmatter including both fences and the closing line break, or '' when absent. */
  block: string
  /** Everything after the block. */
  body: string
}

/**
 * Returns the offset just past the closing fence line (including its line break),
 * or null when the document has no frontmatter.
 */
export function findFrontmatterEnd(raw: string): number | null {
  let lineStart = 0
  let lineIndex = 0

  while (lineStart < raw.length || lineIndex === 0) {
    // Line breaks: \r\n, \n or a lone \r.
    let lineEnd = lineStart
    while (lineEnd < raw.length && raw[lineEnd] !== '\n' && raw[lineEnd] !== '\r') lineEnd++
    let nextLineStart = lineEnd
    if (raw[nextLineStart] === '\r') nextLineStart++
    if (raw[nextLineStart] === '\n') nextLineStart++

    let line = raw.slice(lineStart, lineEnd)
    if (lineIndex === 0) line = line.replace(/^\uFEFF/, '')
    const value = line.trim()

    if (lineIndex === 0) {
      if (value !== '---') return null
    } else if (value === '---' || value === '...') {
      return nextLineStart
    }

    if (nextLineStart === lineEnd) return null
    lineStart = nextLineStart
    lineIndex++
  }

  return null
}

export function splitFrontmatter(raw: string): FrontmatterSplit {
  const end = findFrontmatterEnd(raw)
  if (end === null) return { block: '', body: raw }
  return { block: raw.slice(0, end), body: raw.slice(end) }
}

/**
 * Inverse of splitFrontmatter. When the block has no trailing line break
 * (closing fence at end of file) and a body was added, a line break is inserted
 * so the closing fence stays on its own line.
 */
export function joinFrontmatter(block: string, body: string): string {
  if (!block) return body
  if (body && !/[\r\n]$/.test(block)) return `${block}\n${body}`
  return block + body
}
