// Fork (L1): Obsidian `[[wikilink]]` as an inline atom node in the visual editor.
//
// Reading: `[[Note]]`, `[[Note|別名]]`, `[[Note\|別名]]`, `[[Note#標題]]`, `[[Note#^id]]`,
// `[[#標題]]`, `[[folder/Note]]` and `![[嵌入]]` become one `wikilink` node each; the
// attrs are exactly what `parseWikilink` returns. Saving writes `attrs.raw` back
// byte-for-byte, so the file stays identical to what Obsidian wrote.
//
// Whether a link resolves to an existing note is shown with ProseMirror decorations
// computed from the vault index (never stored in attrs, which would leak into the file).
import { Extension, mergeAttributes, Node, nodeInputRule } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import {
  noteKeyOf,
  parseWikilink,
  resolveWikilinkTarget,
  wikilinkDisplayText,
  type Wikilink as WikilinkData,
} from '@/lib/markdown/wikilink'
import { noteExists, revealInFileTree, writeNote } from '@/lib/daily/note-io'
import useArticleStore from '@/stores/article'
import useVaultIndexStore from '@/stores/vault-index'

export const WIKILINK_NODE_NAME = 'wikilink'
const TOKEN_NAME = 'notegen_wikilink'
const WIKILINK_RE = /^!?\[\[[^\]\n]*?\]\]/

const EMPTY_ATTRS: WikilinkData = { raw: '', target: '', heading: '', blockId: '', alias: '', embed: false }

function attrsOf(raw: string): WikilinkData {
  return parseWikilink(raw) ?? { ...EMPTY_ATTRS, raw }
}

// ---------------------------------------------------------------------------
// Markdown tokenizer

/** 第一個 `[[`（或 `![[`，回傳 `!` 的位置）；沒有時 -1。 */
export function wikilinkStartIndex(src: string): number {
  const index = src.indexOf('[[')
  if (index < 0) return -1
  return index > 0 && src[index - 1] === '!' ? index - 1 : index
}

/** `src` 開頭是合法 wikilink 時回傳 raw，否則 null，讓文字照原樣走。 */
export function matchWikilinkAtStart(src: string): string | null {
  const m = WIKILINK_RE.exec(src)
  if (!m) return null
  return parseWikilink(m[0]) ? m[0] : null
}

// ---------------------------------------------------------------------------
// Table cells: marked turns `\|` into `|` when it splits a row into cells, so a
// wikilink inside a cell would be written back as `[[A|a]]` and split the row in
// Obsidian. Any `|` that reached a cell must have been escaped in the file, so the
// backslash is put back on the wikilink raw before the Table node sees the token.
//
// This runs as a block-level marked tokenizer that only claims tables containing
// `[[`: it lets marked lex the table, tokenizes the cells itself and hands back a
// normal `table` token. Registering a parse handler for `table` instead would shadow
// the Table node's renderer (the manager returns the first handler for a token name).

function escapeWikilinkPipes(tokens: MarkdownToken[] | undefined) {
  if (!tokens) return
  for (const token of tokens) {
    if (token.type === TOKEN_NAME && typeof token.raw === 'string') {
      token.raw = token.raw.replace(/\\?\|/g, '\\|')
    }
    escapeWikilinkPipes(token.tokens)
  }
}

interface TableCellToken { text?: string, tokens?: MarkdownToken[] }
type TokenizeInline = (src: string) => MarkdownToken[]

/** 把 `table` token 每個欄位的文字轉成 inline tokens，並把 wikilink 裡的 `|` 轉回 `\|`。 */
export function tokenizeTableCellsWithWikilinks(token: MarkdownToken, inlineTokens: TokenizeInline): void {
  const cells: TableCellToken[] = [
    ...((token.header as TableCellToken[] | undefined) ?? []),
    ...((token.rows as TableCellToken[][] | undefined) ?? []).flat(),
  ]
  for (const cell of cells) {
    cell.tokens = inlineTokens(cell.text ?? '')
    escapeWikilinkPipes(cell.tokens)
  }
}

// 第一行有 `|`、第二行只有 `|`、`:`、`-`、空白（至少一個 `-`）：便宜的候選檢查，真正判定交給 marked
const TABLE_START_RE = /^[^\n]*\|[^\n]*\n[ \t]{0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*(?=\n|$)/gm

/** 第一個可能是表格開頭、且該表格區塊內含 `[[` 的位置；沒有時 -1。 */
export function wikilinkTableStartIndex(src: string): number {
  if (!src.includes('[[')) return -1
  TABLE_START_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TABLE_START_RE.exec(src))) {
    const chunk = tableChunk(src.slice(m.index))
    if (chunk.includes('[[')) return m.index
    // 這個表格沒有 wikilink：跳到它後面繼續找
    TABLE_START_RE.lastIndex = m.index + chunk.length + 1
  }
  return -1
}

/** 從表格開頭到第一個空白行（表格最多到這裡）。 */
function tableChunk(src: string): string {
  const end = src.search(/\n[ \t]*\n/)
  return end < 0 ? src : src.slice(0, end)
}

// `lexer.blockTokens` 會再經過這個 tokenizer：第二層直接放行，讓 marked 自己的 table 規則處理
let lexingTableChunk = false

const WikilinkTable = Extension.create({
  name: 'notegenWikilinkTable',
  markdownTokenizer: {
    name: 'notegen_wikilink_table',
    level: 'block',
    start: wikilinkTableStartIndex,
    tokenize: (src, _tokens, lexer) => {
      if (lexingTableChunk || wikilinkTableStartIndex(src) !== 0) return undefined
      lexingTableChunk = true
      let table: MarkdownToken | undefined
      try {
        table = lexer.blockTokens(tableChunk(src))[0]
      } finally {
        lexingTableChunk = false
      }
      if (!table || table.type !== 'table' || !table.raw) return undefined
      tokenizeTableCellsWithWikilinks(table, lexer.inlineTokens)
      return table
    },
  },
})

// ---------------------------------------------------------------------------
// Opening / creating notes

/** `圖.png`、`doc.pdf` 這類有字母副檔名的目標視為附件；`2026.10` 不算。 */
function looksLikeAttachment(name: string): boolean {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name)
  return m !== null && /[a-z]/i.test(m[1])
}

/**
 * 解析不到時要建立的新筆記路徑：目標含 `/` 用該相對路徑，否則放在目前筆記的資料夾。
 * 附件類目標（有非 .md 的副檔名）不建立，回傳 null。
 */
export function wikilinkNewNotePath(target: string, sourcePath: string): string | null {
  const clean = target.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/')
  if (!clean) return null
  const isMd = /\.md$/i.test(clean)
  if (!isMd && looksLikeAttachment(noteKeyOf(clean))) return null
  const file = isMd ? clean : `${clean}.md`
  if (file.includes('/')) return file
  const slash = sourcePath.lastIndexOf('/')
  return slash < 0 ? file : `${sourcePath.slice(0, slash)}/${file}`
}

/** 點擊連結：有對應筆記就開啟，沒有就建立再開啟；`[[#標題]]` 與嵌入不動作。 */
export async function openWikilink(link: WikilinkData): Promise<void> {
  if (link.embed || !link.target) return
  const sourcePath = useArticleStore.getState().activeFilePath
  const paths = useVaultIndexStore.getState().notes.keys()
  let path = resolveWikilinkTarget(link.target, paths, sourcePath)
  if (!path) {
    path = wikilinkNewNotePath(link.target, sourcePath)
    if (!path) return
    if (!await noteExists(path)) await writeNote(path, `# ${noteKeyOf(path)}\n`)
  }
  await revealInFileTree(path)
  await useArticleStore.getState().setActiveFilePath(path)
}

// ---------------------------------------------------------------------------
// Resolution decorations

const pluginKey = new PluginKey<DecorationSet>('notegenWikilinkState')
const UNRESOLVED_CLASS = 'notegen-wikilink-unresolved'

/** 同一個索引版本內，同一個目標只解析一次。 */
class WikilinkResolver {
  private revision = -1
  private paths: string[] = []
  private cache = new Map<string, string | null>()

  resolve(target: string, sourcePath: string): string | null {
    const index = useVaultIndexStore.getState()
    if (index.revision !== this.revision) {
      this.revision = index.revision
      this.paths = Array.from(index.notes.keys())
      this.cache.clear()
    }
    const key = `${sourcePath}\u0000${target}`
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const resolved = resolveWikilinkTarget(target, this.paths, sourcePath)
    this.cache.set(key, resolved)
    return resolved
  }
}

function buildDecorations(doc: PMNode, resolver: WikilinkResolver): DecorationSet {
  const sourcePath = useArticleStore.getState().activeFilePath
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== WIKILINK_NODE_NAME) return
    const { target, embed } = node.attrs as WikilinkData
    // 嵌入多半是附件，索引只收筆記，不用「未建立」誤導；`[[#標題]]` 指本篇，永遠存在
    if (embed || !target) return false
    if (resolver.resolve(target, sourcePath) === null) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: UNRESOLVED_CLASS }))
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

function createWikilinkPlugin() {
  const resolver = new WikilinkResolver()
  return new Plugin<DecorationSet>({
    key: pluginKey,
    state: {
      init: (_, state) => buildDecorations(state.doc, resolver),
      apply: (tr, old, _oldState, newState: EditorState) => {
        if (tr.docChanged || tr.getMeta(pluginKey)) return buildDecorations(newState.doc, resolver)
        return old
      },
    },
    props: {
      decorations: state => pluginKey.getState(state),
      handleClickOn: (_view, _pos, node, _nodePos, event, direct) => {
        if (!direct || node.type.name !== WIKILINK_NODE_NAME || event.button !== 0) return false
        const attrs = node.attrs as WikilinkData
        if (attrs.embed || !attrs.target) return false
        event.preventDefault()
        void openWikilink(attrs).catch(error => console.error('[wikilink] open failed', error))
        return true
      },
    },
    view: (view: EditorView) => {
      // 索引變動（新建、改名、刪除）時重算已建立／未建立
      const unsubscribe = useVaultIndexStore.subscribe((state, prev) => {
        if (state.revision === prev.revision) return
        view.dispatch(view.state.tr.setMeta(pluginKey, true))
      })
      return { destroy: unsubscribe }
    },
  })
}

// ---------------------------------------------------------------------------
// Node

export const Wikilink = Node.create({
  name: WIKILINK_NODE_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      raw: { default: '' },
      target: { default: '' },
      heading: { default: '' },
      blockId: { default: '' },
      alias: { default: '' },
      embed: { default: false },
    }
  },

  addExtensions() {
    return [WikilinkTable]
  },

  parseHTML() {
    const getAttrs = (element: HTMLElement | string) => {
      if (typeof element === 'string') return false
      const raw = element.dataset.raw ?? ''
      return parseWikilink(raw) ? attrsOf(raw) : false
    }
    return [
      { tag: 'a[data-type="wikilink"]', getAttrs },
      { tag: 'span[data-type="wikilink"]', getAttrs },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const link = node.attrs as WikilinkData
    const shared = {
      'data-type': 'wikilink',
      'data-raw': link.raw,
      title: link.target || link.heading,
    }
    if (link.embed) {
      return [
        'span',
        mergeAttributes(HTMLAttributes, shared, { class: 'notegen-wikilink notegen-wikilink-embed' }),
        `⧉ ${noteKeyOf(link.target) || wikilinkDisplayText(link)}`,
      ]
    }
    // 不加 href：編輯器既有的 <a href> 點擊處理只認有 href 的連結，點擊由本檔的 plugin 接手
    return [
      'a',
      mergeAttributes(HTMLAttributes, shared, { class: 'notegen-wikilink' }),
      wikilinkDisplayText(link),
    ]
  },

  renderText({ node }) {
    return String(node.attrs.raw ?? '')
  },

  addProseMirrorPlugins() {
    return [createWikilinkPlugin()]
  },

  // 手動打完 `]]`（或 L2 之外的輸入）時，把 `[[...]]` 文字換成節點；不合法的照原樣留著
  addInputRules() {
    return [
      nodeInputRule({
        find: text => {
          const m = /!?\[\[[^\[\]\n]+\]\]$/.exec(text)
          return m && parseWikilink(m[0]) ? { index: m.index, text: m[0] } : null
        },
        type: this.type,
        getAttributes: match => attrsOf(match[0]),
      }),
    ]
  },

  markdownTokenName: TOKEN_NAME,

  markdownTokenizer: {
    name: TOKEN_NAME,
    level: 'inline',
    start: wikilinkStartIndex,
    tokenize: (src: string) => {
      const raw = matchWikilinkAtStart(src)
      if (!raw) return undefined
      // atom node：不再往內 tokenize
      return { type: TOKEN_NAME, raw, tokens: [] }
    },
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    return { type: WIKILINK_NODE_NAME, attrs: attrsOf(token.raw ?? '') }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return String(node.attrs?.raw ?? '')
  },
})

export default Wikilink
