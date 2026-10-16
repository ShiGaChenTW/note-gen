// Fork (F1): keep YAML frontmatter byte-for-byte through the visual editor.
//
// Tiptap's markdown parser cannot tell frontmatter from a thematic break, so the
// leading `---` block used to come back as `---` + a setext `## heading`.
// Before parsing, encodeFrontmatterForEditor() replaces the block with an opaque
// marker that only this node's tokenizer understands; the node keeps the original
// YAML text and renderMarkdown() writes it back unchanged.
import { mergeAttributes, Node } from '@tiptap/core'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'

const MARKER_PREFIX = '<!--notegen:frontmatter:'
const MARKER_SUFFIX = '-->'
const MARKER_RE = /^<!--notegen:frontmatter:([^>]*)-->(?:\r?\n)*/

/** Replace a leading frontmatter block with the marker understood by the Frontmatter node. */
export function encodeFrontmatterForEditor(markdown: string): string {
  const { block, body } = splitFrontmatter(markdown)
  if (!block) return markdown
  const rest = body.replace(/^(?:\r?\n)+/, '')
  return `${MARKER_PREFIX}${encodeURIComponent(block)}${MARKER_SUFFIX}\n\n${rest}`
}

export const Frontmatter = Node.create({
  name: 'frontmatter',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      raw: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'pre[data-type="frontmatter"]',
      getAttrs: element => ({ raw: (element as HTMLElement).dataset.raw ?? '' }),
    }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const raw = String(node.attrs.raw ?? '')
    return [
      'pre',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'frontmatter',
        'data-raw': raw,
        class: 'notegen-frontmatter',
        contenteditable: 'false',
      }),
      raw.replace(/(?:\r?\n)+$/, ''),
    ]
  },

  markdownTokenName: 'notegen_frontmatter',

  markdownTokenizer: {
    name: 'notegen_frontmatter',
    level: 'block',
    start: (src: string) => src.indexOf(MARKER_PREFIX),
    tokenize: (src: string) => {
      const match = MARKER_RE.exec(src)
      if (!match) return undefined
      let raw: string
      try {
        raw = decodeURIComponent(match[1])
      } catch {
        return undefined
      }
      return {
        type: 'notegen_frontmatter',
        raw: match[0],
        content: raw,
        tokens: [],
      }
    },
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    return {
      type: 'frontmatter',
      attrs: { raw: token.content ?? '' },
    }
  },

  // The serializer joins top-level blocks with a blank line, so the block is
  // emitted without its trailing line break: the YAML text stays byte-for-byte,
  // and exactly one blank line separates it from the body (Obsidian's default).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return String(node.attrs?.raw ?? '').replace(/(?:\r?\n)+$/, '')
  },
})

export default Frontmatter
