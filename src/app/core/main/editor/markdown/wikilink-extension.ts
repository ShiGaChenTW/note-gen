// Fork (L1): Obsidian `[[wikilink]]` as an inline atom node in the visual editor.
//
// Reading: `[[Note]]`, `[[Note|別名]]`, `[[Note\|別名]]`, `[[Note#標題]]`, `[[Note#^id]]`,
// `[[#標題]]`, `[[folder/Note]]` and `![[嵌入]]` become one `wikilink` node each; the
// attrs are exactly what `parseWikilink` returns. Saving writes `attrs.raw` back
// byte-for-byte, so the file stays identical to what Obsidian wrote.
//
// Whether a link resolves to an existing note is shown with ProseMirror decorations
// computed from the vault index (never stored in attrs, which would leak into the file).
//
// Phase 2-3a (A-1, A-2): `![[嵌入]]` 以 React node view 轉入目標內容（wikilink-embed-view.tsx；
// 沒有 React 的環境仍走 renderHTML 的 `⧉ 名稱`）；點 `[[Note#標題]]`／`[[Note#^id]]` 開檔後
// 捲到該標題或區塊，`[[#標題]]` 在本篇捲動。
import { Extension, mergeAttributes, Node, nodeInputRule } from '@tiptap/core'
import type { MarkdownToken, NodeViewRenderer } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import {
  noteKeyOf,
  parseWikilink,
  resolveWikilinkTarget,
  wikilinkDisplayText,
  type Wikilink as WikilinkData,
} from '@/lib/markdown/wikilink'
import { normalizeHeadingText } from '@/lib/markdown/note-section'
import { noteExists, revealInFileTree, writeNote } from '@/lib/daily/note-io'
import useArticleStore from '@/stores/article'
import useVaultIndexStore from '@/stores/vault-index'
import { WikilinkEmbedView } from './wikilink-embed-view'

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

/**
 * 點擊連結：有對應筆記就開啟，沒有就建立再開啟；嵌入不動作。
 * `[[#標題]]`／`[[#^id]]` 在本篇捲動；`[[Note#標題]]`／`[[Note#^id]]` 開啟後捲到目標
 * （目標就是本篇時只捲動）。`view` 是點擊發生的編輯器，本篇捲動用它。
 */
export async function openWikilink(link: WikilinkData, view?: EditorView): Promise<void> {
  if (link.embed) return
  const anchor: WikilinkAnchor = { heading: link.heading, blockId: link.blockId }
  const hasAnchor = Boolean(anchor.heading || anchor.blockId)
  const sourcePath = useArticleStore.getState().activeFilePath
  if (!link.target) {
    if (hasAnchor) scrollToWikilinkAnchorInView(anchor, view)
    return
  }
  const paths = useVaultIndexStore.getState().notes.keys()
  let path = resolveWikilinkTarget(link.target, paths, sourcePath)
  if (path && hasAnchor && path === sourcePath) {
    scrollToWikilinkAnchorInView(anchor, view)
    return
  }
  if (!path) {
    path = wikilinkNewNotePath(link.target, sourcePath)
    if (!path) return
    if (!await noteExists(path)) await writeNote(path, `# ${noteKeyOf(path)}\n`)
  }
  if (hasAnchor) queueWikilinkScroll(path, anchor, view)
  await revealInFileTree(path)
  await useArticleStore.getState().setActiveFilePath(path)
  if (hasAnchor) flushPendingScrollLater()
}

// ---------------------------------------------------------------------------
// Jumping to `#標題` / `^id` (A-2)
//
// 同一個分頁只有一個編輯器，但每個分頁的編輯器都掛著（非作用中的 display:none），
// 所以這裡記住所有活著的 view：本篇捲動直接用點擊時的 view；跨篇時先排一個待辦
// （路徑＋目標），目標筆記的 view 載入內容（doc 變動）或分頁切到它（可見）時再捲。

export interface WikilinkAnchor { heading: string, blockId: string }

const HIGHLIGHT_CLASS = 'notegen-wikilink-target'
const HIGHLIGHT_MS = 1500
const PENDING_SCROLL_MS = 10_000
const FLUSH_DELAYS_MS = [0, 100, 300, 1000]

const scrollKey = new PluginKey<DecorationSet>('notegenWikilinkScroll')
const liveViews = new Set<EditorView>()

interface PendingScroll { path: string, anchor: WikilinkAnchor, origin: EditorView | undefined, expires: number }
let pendingScroll: PendingScroll | null = null

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 標題節點的文字：wikilink 原子節點用它的顯示文字。 */
function headingTextOf(node: PMNode): string {
  return node.textBetween(0, node.content.size, '', leaf => (
    leaf.type.name === WIKILINK_NODE_NAME ? wikilinkDisplayText(leaf.attrs as WikilinkData) : ''
  ))
}

/**
 * 在文件裡找目標：`#標題` 比對 heading 節點（正規化後相同），`^id` 找行尾有 `^id` 的文字區塊
 * （段落、清單項的段落、表格格子）。找不到回傳 null。
 */
export function findWikilinkAnchor(doc: PMNode, anchor: WikilinkAnchor): { pos: number, node: PMNode } | null {
  let found: { pos: number, node: PMNode } | null = null
  if (anchor.blockId) {
    const re = new RegExp(`(?:^|\\s)\\^${escapeRegExp(anchor.blockId.trim())}\\s*$`, 'i')
    doc.descendants((node, pos) => {
      if (found) return false
      if (!node.isTextblock) return true
      if (re.test(node.textContent)) found = { pos, node }
      return false
    })
    return found
  }
  const wanted = normalizeHeadingText(anchor.heading)
  if (!wanted) return null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name !== 'heading') return true
    if (normalizeHeadingText(headingTextOf(node)) === wanted) found = { pos, node }
    return false
  })
  return found
}

/** 捲到目標並（區塊時）短暫高亮；找不到回傳 false。 */
export function scrollToWikilinkAnchor(view: EditorView, anchor: WikilinkAnchor): boolean {
  const hit = findWikilinkAnchor(view.state.doc, anchor)
  if (!hit) return false
  const { pos, node } = hit
  // 游標放到目標開頭（不搶焦點），之後的輸入落在那裡；區塊再加 1.5 秒高亮
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1))
  if (anchor.blockId) tr.setMeta(scrollKey, { highlight: { from: pos, to: pos + node.nodeSize } })
  view.dispatch(tr)
  const dom = view.nodeDOM(pos)
  if (dom instanceof HTMLElement && typeof dom.scrollIntoView === 'function') {
    dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } else {
    view.dispatch(view.state.tr.scrollIntoView())
  }
  if (anchor.blockId) {
    setTimeout(() => {
      if (liveViews.has(view)) view.dispatch(view.state.tr.setMeta(scrollKey, { clear: true }))
    }, HIGHLIGHT_MS)
  }
  return true
}

function isVisibleView(view: EditorView): boolean {
  const dom = view.dom
  if (!dom.isConnected) return false
  return typeof dom.getClientRects !== 'function' || dom.getClientRects().length > 0
}

/** 本篇捲動：優先用點擊的 view，沒有就用目前看得到的那個。 */
function scrollToWikilinkAnchorInView(anchor: WikilinkAnchor, view?: EditorView): boolean {
  if (view && liveViews.has(view)) return scrollToWikilinkAnchor(view, anchor)
  for (const candidate of liveViews) {
    if (isVisibleView(candidate) && scrollToWikilinkAnchor(candidate, anchor)) return true
  }
  return false
}

/** 排一個「開檔後捲動」的待辦；只會有一個，新的蓋掉舊的。 */
export function queueWikilinkScroll(path: string, anchor: WikilinkAnchor, origin?: EditorView): void {
  pendingScroll = { path, anchor, origin, expires: Date.now() + PENDING_SCROLL_MS }
}

/** 給測試用：清掉待辦。 */
export function clearPendingWikilinkScroll(): void {
  pendingScroll = null
}

/**
 * 這個 view 的內容若已是待辦的那篇（作用中路徑相同且找得到目標）就捲過去。
 * 從 plugin view 的 update 呼叫時正在套用 transaction，所以捲動延後一個 tick。
 */
function tryPendingScroll(view: EditorView, { requireVisible = false } = {}): boolean {
  const pending = pendingScroll
  if (!pending) return false
  if (Date.now() > pending.expires) {
    pendingScroll = null
    return false
  }
  if (useArticleStore.getState().activeFilePath !== pending.path) return false
  if (requireVisible && !isVisibleView(view)) return false
  if (!findWikilinkAnchor(view.state.doc, pending.anchor)) return false
  pendingScroll = null
  setTimeout(() => {
    if (liveViews.has(view)) scrollToWikilinkAnchor(view, pending.anchor)
  }, 0)
  return true
}

/**
 * 開檔完成後：目標分頁本來就開著時 doc 不會變，所以改在看得到的 view 上試幾次
 * （React 切分頁要等下一次 commit）。點擊來源的 view 先跳過，避免兩篇有同名標題時捲錯。
 */
function flushPendingScrollLater(): void {
  const attempt = () => {
    const pending = pendingScroll
    if (!pending) return
    const others = Array.from(liveViews).filter(view => view !== pending.origin)
    for (const view of others) {
      if (tryPendingScroll(view, { requireVisible: true })) return
    }
  }
  for (const delay of FLUSH_DELAYS_MS) setTimeout(attempt, delay)
}

function createWikilinkScrollPlugin() {
  return new Plugin<DecorationSet>({
    key: scrollKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, old) => {
        const meta = tr.getMeta(scrollKey) as { highlight?: { from: number, to: number }, clear?: boolean } | undefined
        if (meta?.clear) return DecorationSet.empty
        if (meta?.highlight) {
          const { from, to } = meta.highlight
          return DecorationSet.create(tr.doc, [Decoration.node(from, to, { class: HIGHLIGHT_CLASS })])
        }
        return tr.docChanged ? old.map(tr.mapping, tr.doc) : old
      },
    },
    props: {
      decorations: state => scrollKey.getState(state),
    },
    view: (view: EditorView) => {
      liveViews.add(view)
      tryPendingScroll(view)
      return {
        update: (current, prev) => {
          if (current.state.doc !== prev.doc) tryPendingScroll(current)
        },
        destroy: () => { liveViews.delete(view) },
      }
    },
  })
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
      handleClickOn: (view, _pos, node, _nodePos, event, direct) => {
        if (!direct || node.type.name !== WIKILINK_NODE_NAME || event.button !== 0) return false
        const attrs = node.attrs as WikilinkData
        // 嵌入由它的 node view 自己處理；`[[#標題]]` 沒有 target 但要在本篇捲動
        if (attrs.embed || !(attrs.target || attrs.heading || attrs.blockId)) return false
        event.preventDefault()
        void openWikilink(attrs, view).catch(error => console.error('[wikilink] open failed', error))
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
    return [createWikilinkPlugin(), createWikilinkScrollPlugin()]
  },

  // 只有嵌入走 React node view；一般連結與沒有 React（EditorContent）的環境回傳空物件，
  // ProseMirror 就退回 renderHTML（ReactNodeViewRenderer 本身在沒有 contentComponent 時也是如此）
  addNodeView() {
    const renderEmbed = ReactNodeViewRenderer(WikilinkEmbedView, { as: 'span', className: 'notegen-embed-host' })
    const fallback = {} as ReturnType<NodeViewRenderer>
    return props => ((props.node.attrs as WikilinkData).embed ? renderEmbed(props) : fallback)
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
