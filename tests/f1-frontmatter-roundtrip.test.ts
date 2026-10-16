// @vitest-environment jsdom
// F1: frontmatter must survive the visual editor byte-for-byte.
// Without the Frontmatter node, `---` became a thematic break and the first key a `## heading`.
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import {
  MarkdownParagraph,
  normalizeMarkdownPlaceholders,
} from '@/app/core/main/editor/markdown/markdown-paragraph'
import {
  encodeFrontmatterForEditor,
  Frontmatter,
} from '@/app/core/main/editor/markdown/frontmatter-extension'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'

// Mirrors the block-level setup of tiptap-editor.tsx.
function createEditor(withFrontmatter = true) {
  return new Editor({
    extensions: [
      ...(withFrontmatter ? [Frontmatter] : []),
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        link: false,
        paragraph: false,
        underline: false,
        dropcursor: false,
      }),
      MarkdownParagraph,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
  })
}

function load(editor: Editor, raw: string) {
  editor.chain().setMeta('addToHistory', false)
    .setContent(encodeFrontmatterForEditor(raw), { contentType: 'markdown' }).run()
}

function save(editor: Editor) {
  return normalizeMarkdownPlaceholders(editor.getMarkdown())
}

const samples: Record<string, string> = {
  'daily note': `---
created: 2026-10-16
tags:
  - daily
  - journal
aliases: [今天]
---

# 20261016

morning:: done
`,
  'comments, quotes, no blank separator': `---
title: "Acme: 合約"  # 註解
status: active
links:
  - "[[Acme]]"
---
內文第一段
`,
  'two blank lines + tasks': `---
due: 2026-10-20
---


- [ ] 買菜 📅 2026-10-20
- [x] 寄信 ✅ 2026-10-16
`,
  'CRLF frontmatter': '---\r\ntitle: A\r\n---\r\n\r\nBody\n',
  'frontmatter only': '---\na: 1\n---\n',
}

describe('F1: frontmatter round trip through the visual editor', () => {
  it('reproduces the original bug without the Frontmatter node', () => {
    const editor = createEditor(false)
    editor.chain().setContent(samples['daily note'], { contentType: 'markdown' }).run()
    expect(save(editor)).toContain('## created: 2026-10-16')
    editor.destroy()
  })

  for (const [name, raw] of Object.entries(samples)) {
    it(`${name}: frontmatter unchanged, one blank line before body`, () => {
      const editor = createEditor()
      load(editor, raw)
      const out = save(editor)
      editor.destroy()
      const { block, body } = splitFrontmatter(raw)
      const yaml = block.replace(/(?:\r?\n)+$/, '')
      const rest = body.replace(/^(?:\r?\n)+/, '')
      // YAML is byte-for-byte; exactly one blank line before the body.
      expect(out.startsWith(rest ? `${yaml}\n\n` : yaml)).toBe(true)
      expect(splitFrontmatter(out).block.replace(/(?:\r?\n)+$/, '')).toBe(yaml)
      if (rest) expect(out.slice(yaml.length + 2)).not.toMatch(/^\n/)
    })
  }

  it('keeps frontmatter after editing the body', () => {
    const raw = samples['daily note']
    const editor = createEditor()
    load(editor, raw)
    editor.commands.focus('end')
    editor.commands.insertContent('新增一行')
    const out = save(editor)
    editor.destroy()
    expect(out.startsWith(splitFrontmatter(raw).block + '\n')).toBe(true)
    expect(out).toContain('新增一行')
  })

  for (const [name, raw] of Object.entries(samples)) {
    it(`${name}: stable across repeated load/save`, () => {
      const editor = createEditor()
      load(editor, raw)
      const first = save(editor)
      load(editor, first)
      expect(save(editor)).toBe(first)
      editor.destroy()
    })
  }

  it('daily note with one blank separator round-trips byte-for-byte', () => {
    const editor = createEditor()
    load(editor, samples['daily note'])
    expect(save(editor).trimEnd()).toBe(samples['daily note'].trimEnd())
    editor.destroy()
  })

  it('leaves documents without frontmatter untouched by the encoder', () => {
    const raw = '# Title\n\n---\n\ntext\n'
    expect(encodeFrontmatterForEditor(raw)).toBe(raw)
  })
})
