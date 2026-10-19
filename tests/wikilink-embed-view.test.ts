// @vitest-environment jsdom
// A-1 (Phase 2-3a): `![[嵌入]]` content transclusion. The React node view itself needs an
// EditorContent to mount, so these tests cover the pure parts it is built from: target
// classification, attachment lookup, loading (with injected I/O, nested embeds, depth limit,
// cycles) and the markdown-it rendering (wikilinks, nested embeds, images, escaping).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseWikilink } from '@/lib/markdown/wikilink'
import useVaultIndexStore from '@/stores/vault-index'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import * as noteIo from '@/lib/daily/note-io'
import {
  classifyEmbedTarget,
  clearEmbedContentCache,
  defaultEmbedDeps,
  EMBED_TEXT,
  loadEmbed,
  parseEmbedSize,
  renderEmbedHtml,
  resolveAttachmentPath,
  type EmbedDeps,
  type EmbedNote,
} from '@/app/core/main/editor/markdown/wikilink-embed-view'

vi.mock('@/lib/daily/note-io', () => ({
  noteExists: vi.fn(async () => false),
  readNote: vi.fn(async () => null),
  writeNote: vi.fn(async () => undefined),
  revealInFileTree: vi.fn(async () => undefined),
}))

const vault: Record<string, string> = {
  'A.md': '---\ntitle: A\n---\n\n# A\n\nA 的內文 [[B]]。\n\n![[B]]\n\n## 第二節\n\n第二節 ^blk\n\n![[圖.png|300]] 與 ![[doc.pdf]]\n',
  'B.md': 'B 的內文。\n\n![[C]]\n\n行內 ![[C]] 文字\n',
  'C.md': 'C 的內文。\n\n![[D]]\n\n![[A]]\n',
  'D.md': 'D 的內文。\n',
  'Loop.md': '循環 ![[Loop]]\n',
  'Html.md': '<script>alert(1)</script> **粗** ![圖](img/x.png) [外部](https://example.com) [[A#第二節]]\n',
  'Missing-embed.md': '![[Nope]]\n',
}

function deps(overrides: Partial<EmbedDeps> = {}): EmbedDeps {
  return {
    readNote: async path => vault[path] ?? null,
    resolveNote: target => {
      const key = target.replace(/\.md$/i, '')
      return `${key}.md` in vault ? `${key}.md` : null
    },
    attachmentExists: async path => path === 'folder/圖.png' || path === 'doc.pdf',
    ...overrides,
  }
}

function link(raw: string) {
  return parseWikilink(raw)!
}

async function loadNote(raw: string, source = 'Source.md', d = deps()): Promise<EmbedNote> {
  const result = await loadEmbed(link(raw), source, d)
  expect(result.kind).toBe('note')
  return result as EmbedNote
}

describe('A-1: target classification and sizes', () => {
  it('classifyEmbedTarget', () => {
    expect(classifyEmbedTarget('Note')).toBe('note')
    expect(classifyEmbedTarget('Note.md')).toBe('note')
    expect(classifyEmbedTarget('2026.10')).toBe('note')
    expect(classifyEmbedTarget('folder/圖.PNG')).toBe('image')
    expect(classifyEmbedTarget('圖.webp')).toBe('image')
    expect(classifyEmbedTarget('doc.pdf')).toBe('attachment')
    expect(classifyEmbedTarget('a.docx')).toBe('attachment')
  })

  it('parseEmbedSize', () => {
    expect(parseEmbedSize('300')).toEqual({ width: 300 })
    expect(parseEmbedSize('300x200')).toEqual({ width: 300, height: 200 })
    expect(parseEmbedSize('別名')).toBeNull()
    expect(parseEmbedSize('')).toBeNull()
  })

  it('resolveAttachmentPath: same folder first, then vault root', async () => {
    const exists = deps().attachmentExists
    expect(await resolveAttachmentPath('圖.png', 'folder/Note.md', exists)).toBe('folder/圖.png')
    expect(await resolveAttachmentPath('doc.pdf', 'folder/Note.md', exists)).toBe('doc.pdf')
    expect(await resolveAttachmentPath('nope.png', 'folder/Note.md', exists)).toBeNull()
    expect(await resolveAttachmentPath('', 'folder/Note.md', exists)).toBeNull()
  })
})

describe('A-1: loadEmbed', () => {
  it('whole note: frontmatter stripped, nested note embeds loaded', async () => {
    const note = await loadNote('![[A]]')
    expect(note.path).toBe('A.md')
    expect(note.markdown.startsWith('# A\n')).toBe(true)
    expect(note.sectionMissing).toBe(false)
    expect(Array.from(note.children.keys())).toEqual(['![[B]]'])
    const b = note.children.get('![[B]]')!
    expect(b.path).toBe('B.md')
    // depth 2 (B) does not load its own embeds: C stays unloaded (not in the map)
    expect(b.children.size).toBe(0)
  })

  it('#heading: only that section', async () => {
    const note = await loadNote('![[A#第二節]]')
    expect(note.markdown).toBe('## 第二節\n\n第二節 ^blk\n\n![[圖.png|300]] 與 ![[doc.pdf]]')
    expect(note.sectionMissing).toBe(false)
  })

  it('#^id: only that block, marker removed', async () => {
    const note = await loadNote('![[A#^blk]]')
    expect(note.markdown).toBe('第二節')
  })

  it('missing heading / block: sectionMissing', async () => {
    expect((await loadNote('![[A#沒有]]')).sectionMissing).toBe(true)
    expect((await loadNote('![[A#^nope]]')).sectionMissing).toBe(true)
  })

  it('unresolved note: missing', async () => {
    expect(await loadEmbed(link('![[Nope]]'), 'Source.md', deps())).toEqual({ kind: 'missing' })
    // resolved in the index but gone on disk
    expect(await loadEmbed(link('![[A]]'), 'Source.md', deps({ readNote: async () => null }))).toEqual({ kind: 'missing' })
  })

  it('unresolved nested embed is recorded as null', async () => {
    const note = await loadNote('![[Missing-embed]]')
    expect(note.children.get('![[Nope]]')).toBeNull()
  })

  it('cycles are not loaded (A → C → A)', async () => {
    const c = await loadNote('![[C]]')
    expect(c.children.has('![[D]]')).toBe(true)
    expect(c.children.has('![[A]]')).toBe(true) // A is not an ancestor of C here
    const loop = await loadNote('![[Loop]]')
    expect(loop.children.has('![[Loop]]')).toBe(false)
  })

  it('image and attachment targets', async () => {
    expect(await loadEmbed(link('![[圖.png|300]]'), 'folder/Note.md', deps())).toEqual({ kind: 'image', path: 'folder/圖.png', width: 300 })
    expect(await loadEmbed(link('![[圖.png]]'), 'folder/Note.md', deps())).toEqual({ kind: 'image', path: 'folder/圖.png' })
    expect(await loadEmbed(link('![[doc.pdf]]'), 'folder/Note.md', deps())).toEqual({ kind: 'attachment', path: 'doc.pdf' })
    expect(await loadEmbed(link('![[nope.pdf]]'), 'folder/Note.md', deps())).toEqual({ kind: 'missing' })
  })
})

describe('A-1: renderEmbedHtml', () => {
  it('wikilinks become clickable text, raw html is escaped, images and external links kept', async () => {
    const note = await loadNote('![[Html]]')
    const html = renderEmbedHtml(note)
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<a class="notegen-wikilink" data-raw="[[A#第二節]]" title="A">A &gt; 第二節</a>')
    expect(html).toContain('<img class="notegen-embed-img" data-notegen-src="img/x.png" data-notegen-note="Html.md" alt="圖">')
    expect(html).toContain('<a href="https://example.com">外部</a>')
  })

  it('nested embed alone in a paragraph is a block, inline one is a span; depth 3 is a chip', async () => {
    const a = await loadNote('![[A]]')
    const html = renderEmbedHtml(a)
    // top-level content (depth 1) transcludes B as a block (no <p> around it)
    expect(html).toContain('<div class="notegen-embed notegen-embed-nested" data-depth="2">')
    expect(html).not.toContain('<p><div')
    expect(html).toContain('data-notegen-open="B.md">⧉ B</button>')
    expect(html).toContain('B 的內文。')
    // B's own embeds (depth 3) are not transcluded
    expect(html).toContain('notegen-embed-too-deep">⧉ C</span>')
    expect(html).not.toContain('C 的內文')
    // the inline one inside B is also a chip at that depth
    expect(html).toContain('行內 <span class="notegen-wikilink notegen-wikilink-embed notegen-embed-too-deep">⧉ C</span> 文字')
  })

  it('inline nested embed with text in the same paragraph: the <p> is unwrapped and the embed is a block (block content inside <p>/<span> would be torn apart by the browser)', async () => {
    const b = await loadNote('![[B]]')
    const html = renderEmbedHtml(b)
    expect(html).toContain('<div class="notegen-embed notegen-embed-nested" data-depth="2">')
    expect(html).toContain('行內 <div class="notegen-embed notegen-embed-nested" data-depth="2">')
    expect(html).not.toContain('<p>行內')
    expect(html).not.toContain('<span class="notegen-embed notegen-embed-nested"')
  })

  it('unresolved nested embed shows 找不到, cycle shows the plain chip', async () => {
    const html = renderEmbedHtml(await loadNote('![[Missing-embed]]'))
    expect(html).toContain(`notegen-wikilink-unresolved">${EMBED_TEXT.notFound} ⧉ Nope</span>`)
    const loop = renderEmbedHtml(await loadNote('![[Loop]]'))
    expect(loop).toContain('notegen-embed-too-deep">⧉ Loop</span>')
  })

  it('image / attachment wikilink embeds inside content', async () => {
    const html = renderEmbedHtml(await loadNote('![[A#第二節]]'))
    expect(html).toContain('<img class="notegen-embed-img" data-notegen-target="圖.png" data-notegen-note="A.md" alt="圖.png" width="300">')
    expect(html).toContain('notegen-wikilink-embed ">📎 doc.pdf</span>')
  })

  it('nested section that is missing says so', async () => {
    const d = deps({ readNote: async path => (path === 'X.md' ? '![[A#沒有]]\n' : vault[path] ?? null), resolveNote: t => (t === 'X' ? 'X.md' : deps().resolveNote(t, '')) })
    const html = renderEmbedHtml(await loadNote('![[X]]', 'Source.md', d))
    expect(html).toContain(EMBED_TEXT.sectionNotFound)
  })
})

describe('A-1: default deps cache follows the index mtime', () => {
  const io = vi.mocked(noteIo)

  function setIndex(entries: Array<[string, number]>) {
    const notes = new Map<string, IndexedNote>(entries.map(([path, mtime]) => [path, { path, mtime, frontmatter: null, tasks: [], links: [], aliases: [], tags: [] }]))
    useVaultIndexStore.getState().replaceAll(notes)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    clearEmbedContentCache()
    setIndex([['A.md', 1]])
    io.readNote.mockImplementation(async path => vault[path] ?? null)
  })

  it('reads once per path+mtime, again after the watcher bumps the mtime', async () => {
    await defaultEmbedDeps.readNote('A.md')
    await defaultEmbedDeps.readNote('A.md')
    expect(io.readNote).toHaveBeenCalledTimes(1)
    setIndex([['A.md', 2]])
    await defaultEmbedDeps.readNote('A.md')
    expect(io.readNote).toHaveBeenCalledTimes(2)
  })

  it('resolves notes through the vault index', () => {
    setIndex([['folder/A.md', 1]])
    expect(defaultEmbedDeps.resolveNote('A', 'Other.md')).toBe('folder/A.md')
    expect(defaultEmbedDeps.resolveNote('Nope', 'Other.md')).toBeNull()
  })
})
