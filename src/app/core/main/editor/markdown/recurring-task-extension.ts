// Fork (D5): when a `🔁 every …` task is checked in the editor, stamp it with
// `✅ today` and insert the next occurrence right below, like Obsidian Tasks.
//
// Only a single checkbox toggle triggers this (one AttrStep / ReplaceAroundStep on
// a taskItem whose text did not change), so loading a file that was completed in
// Obsidian never adds a second copy.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { AttrStep, ReplaceAroundStep } from '@tiptap/pm/transform'
import { completeRecurringText } from '@/lib/daily/recurrence'

const pluginKey = new PluginKey('notegenRecurringTask')

/** Position of the taskItem a lone checkbox toggle checked, or null. */
function checkedTaskPos(tr: Transaction, before: PMNode): number | null {
  if (tr.steps.length !== 1 || tr.getMeta('addToHistory') === false || tr.getMeta(pluginKey)) return null
  const step = tr.steps[0]
  const pos = step instanceof AttrStep ? step.pos : step instanceof ReplaceAroundStep ? step.from : null
  if (pos === null) return null
  const oldNode = before.nodeAt(pos)
  const newNode = tr.doc.nodeAt(pos)
  if (oldNode?.type.name !== 'taskItem' || newNode?.type.name !== 'taskItem') return null
  if (oldNode.attrs.checked || !newNode.attrs.checked) return null
  if (oldNode.textContent !== newNode.textContent) return null
  return pos
}

export const RecurringTask = Extension.create({
  name: 'notegenRecurringTask',

  addProseMirrorPlugins() {
    return [new Plugin({
      key: pluginKey,
      appendTransaction: (transactions, oldState, newState) => {
        if (transactions.length !== 1) return null
        const pos = checkedTaskPos(transactions[0], oldState.doc)
        if (pos === null) return null
        const item = newState.doc.nodeAt(pos)
        const paragraph = item?.firstChild
        if (!item || !paragraph || paragraph.type.name !== 'paragraph') return null

        const result = completeRecurringText(paragraph.textContent, new Date())
        if (!result) return null

        const { schema } = newState
        const tr = newState.tr
        const paragraphStart = pos + 1
        const paragraphEnd = paragraphStart + paragraph.nodeSize - 1
        const current = paragraph.textContent
        // 只是在行尾加上 ✅ 日期時保留原本的行內格式；否則改成純文字
        if (result.completed.startsWith(current)) {
          const suffix = result.completed.slice(current.length)
          if (suffix) tr.insertText(suffix, paragraphEnd)
        } else {
          tr.replaceWith(paragraphStart + 1, paragraphEnd, schema.text(result.completed))
        }

        const afterItem = tr.mapping.map(pos + item.nodeSize)
        const nextItem = schema.nodes.taskItem.create(
          { ...item.attrs, checked: false },
          schema.nodes.paragraph.create(null, result.next ? schema.text(result.next) : null),
        )
        tr.insert(afterItem, nextItem)
        tr.setMeta(pluginKey, true)
        return tr
      },
    })]
  },
})
