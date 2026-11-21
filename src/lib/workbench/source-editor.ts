// Fork（almanac ALMNC-54.8）：資料源整頁編輯器（E）的純函式——標題／內文拆合、字數、儲存後會變成哪一版。
// 資料源沒有獨立的標題欄位：第一行就是標題（sources-tab.ts sourceTitle），存回去時合成「標題＋空行＋內文」。
// 已送出（鎖定）的資料源存檔會另存新版本 vN，舊版保留（v3-model/source.ts editSourceContent）。

export interface EditorDoc {
  title: string
  body: string
}

/** 原文 → 編輯器的標題與內文。第一行若是 Markdown 標題就去掉 #。 */
export function splitContent(content: string, fallbackTitle = ''): EditorDoc {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  if (!lines.length) return { title: fallbackTitle, body: '' }
  const title = lines.shift()!.replace(/^#+\s*/, '').trim()
  while (lines.length && !lines[0].trim()) lines.shift()
  return { title, body: lines.join('\n').trimEnd() }
}

/** 編輯器 → 原文。沒有標題就只存內文。 */
export function joinContent(doc: EditorDoc): string {
  const title = doc.title.trim()
  const body = doc.body.trimEnd()
  if (!title) return body
  return body ? `${title}\n\n${body}` : title
}

/** 字數：標題加內文、不算空白（中文一字一算，同 v14）。 */
export function wordCount(doc: EditorDoc): number {
  return Array.from(`${doc.title}${doc.body}`.replace(/\s/g, '')).length
}

export function isChanged(original: string, doc: EditorDoc): boolean {
  return joinContent(doc) !== joinContent(splitContent(original))
}

/** 儲存後的版本：已送出（鎖定）的另存 v(N+1)，草稿原地改（版本不變）。 */
export function versionAfterSave(current: { version: number, locked: boolean }): { version: number, versioned: boolean } {
  return current.locked ? { version: current.version + 1, versioned: true } : { version: current.version, versioned: false }
}

/** 格式工具列：把選取的文字包起來或在行首加符號（textarea 版，不靠 contenteditable）。 */
export type FormatKind = 'heading' | 'bold' | 'italic' | 'bullet' | 'numbered' | 'task' | 'quote' | 'link' | 'rule'

export function applyFormat(text: string, start: number, end: number, kind: FormatKind): { text: string, start: number, end: number } {
  const selected = text.slice(start, end)
  const wrap = (left: string, right = left) => {
    const next = `${text.slice(0, start)}${left}${selected}${right}${text.slice(end)}`
    return { text: next, start: start + left.length, end: end + left.length }
  }
  const prefix = (marker: (index: number) => string) => {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const block = text.slice(lineStart, end)
    const lines = block.split('\n')
    const replaced = lines.map((line, index) => `${marker(index)}${line}`).join('\n')
    const next = `${text.slice(0, lineStart)}${replaced}${text.slice(end)}`
    return { text: next, start: lineStart, end: lineStart + replaced.length }
  }
  switch (kind) {
    case 'bold': return wrap('**')
    case 'italic': return wrap('*')
    case 'link': return wrap('[', '](https://)')
    case 'heading': return prefix(() => '## ')
    case 'bullet': return prefix(() => '- ')
    case 'numbered': return prefix(index => `${index + 1}. `)
    case 'task': return prefix(() => '- [ ] ')
    case 'quote': return prefix(() => '> ')
    case 'rule': {
      const insert = `${start > 0 && text[start - 1] !== '\n' ? '\n' : ''}\n---\n`
      const next = `${text.slice(0, start)}${insert}${text.slice(end)}`
      return { text: next, start: start + insert.length, end: start + insert.length }
    }
  }
}
