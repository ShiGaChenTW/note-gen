// Fork（#46）：Inbox 的「轉成筆記」——一筆記錄直接變成一則筆記，不經 AI。
import type { Mark } from '@/db/marks'
import { parseTodoMarkContent } from '@/app/core/main/mark/mark-list-item-content'

function clean(value?: string | null): string {
  return (value ?? '').trim()
}

/** 筆記內文；第一行同時決定檔名。 */
export function recordNoteContent(mark: Pick<Mark, 'type' | 'content' | 'desc' | 'url'>): string {
  const content = clean(mark.content)
  const desc = clean(mark.desc)
  const url = clean(mark.url)
  let body: string
  switch (mark.type) {
    case 'todo': {
      const todo = parseTodoMarkContent(mark as Mark)
      body = [`- [${todo.completed ? 'x' : ' '}] ${todo.title}`, todo.description].filter(Boolean).join('\n\n')
      break
    }
    case 'link':
      body = [url ? `[${desc || url}](${url})` : desc, content].filter(Boolean).join('\n\n')
      break
    case 'file':
      body = [desc || url, content].filter(Boolean).join('\n\n')
      break
    case 'recording':
      body = [desc, content].filter(Boolean).join('\n\n')
      break
    case 'scan':
    case 'image':
      body = [desc && desc !== content ? desc : '', content].filter(Boolean).join('\n\n')
      break
    default:
      body = content || desc
  }
  return `${body.trim()}\n`
}
