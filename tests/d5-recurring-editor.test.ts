// @vitest-environment jsdom
// D5: checking a `🔁` task in the visual editor adds the next occurrence below it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { MarkdownParagraph } from '@/app/core/main/editor/markdown/markdown-paragraph'
import { RecurringTask } from '@/app/core/main/editor/markdown/recurring-task-extension'

function createEditor(markdown: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ blockquote: false, codeBlock: false, link: false, paragraph: false, underline: false, dropcursor: false }),
      MarkdownParagraph,
      TaskList,
      TaskItem.configure({ nested: true }),
      RecurringTask,
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
    content: markdown,
    contentType: 'markdown',
  })
}

// StarterKit's trailing empty paragraph serializes as `&nbsp;`; not part of what we check.
function markdown(editor: Editor): string {
  return editor.getMarkdown().replace(/\s*&nbsp;\s*$/, '').trim()
}

function taskPositions(editor: Editor): number[] {
  const out: number[] = []
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'taskItem') out.push(pos) })
  return out
}

/** Same transaction shape as clicking the checkbox (TaskItem's node view uses setNodeMarkup). */
function setChecked(editor: Editor, pos: number, checked: boolean) {
  editor.chain().command(({ tr }) => {
    const node = tr.doc.nodeAt(pos)!
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked })
    return true
  }).run()
}

describe('RecurringTask extension', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 18, 10, 0))
  })
  afterEach(() => { vi.useRealTimers() })

  it('勾選 🔁 任務時標上 ✅ 並在下一行產生下一次', () => {
    const editor = createEditor('- [ ] 澆花 🔁 every week 📅 2026-10-18\n- [ ] 其他')
    setChecked(editor, taskPositions(editor)[0], true)
    expect(markdown(editor)).toBe([
      '- [x] 澆花 🔁 every week 📅 2026-10-18 ✅ 2026-10-18',
      '- [ ] 澆花 🔁 every week 📅 2026-10-25',
      '- [ ] 其他',
    ].join('\n'))
    editor.destroy()
  })

  it('沒有 🔁 的任務照常勾選，不加任何東西', () => {
    const editor = createEditor('- [ ] 一般任務 📅 2026-10-18')
    setChecked(editor, taskPositions(editor)[0], true)
    expect(markdown(editor)).toBe('- [x] 一般任務 📅 2026-10-18')
    editor.destroy()
  })

  it('取消勾選不產生新任務', () => {
    const editor = createEditor('- [x] 澆花 🔁 every day 📅 2026-10-18 ✅ 2026-10-18')
    setChecked(editor, taskPositions(editor)[0], false)
    expect(taskPositions(editor)).toHaveLength(1)
    editor.destroy()
  })

  it('載入已在 Obsidian 勾選的檔案不會多產生一筆', () => {
    const editor = createEditor('- [ ] 澆花 🔁 every day 📅 2026-10-18')
    editor.commands.setContent('- [x] 澆花 🔁 every day 📅 2026-10-18 ✅ 2026-10-18\n- [ ] 澆花 🔁 every day 📅 2026-10-19', { contentType: 'markdown' })
    expect(taskPositions(editor)).toHaveLength(2)
    editor.destroy()
  })
})
