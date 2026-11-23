import { Editor, type EditorOptions } from '@tiptap/core'
import { afterEach } from 'vitest'

// Register at suite scope so failed assertions still release the editor views
// before Vitest tears down jsdom.
export function createTestEditorFactory() {
  const editors: Editor[] = []

  afterEach(() => {
    for (const editor of editors.splice(0)) {
      editor.destroy()
    }
  })

  return (options: Partial<EditorOptions>) => {
    const editor = new Editor(options)
    editors.push(editor)
    return editor
  }
}
