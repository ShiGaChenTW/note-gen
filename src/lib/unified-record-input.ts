import type { Mark } from '@/db/marks'

export const unifiedRecordTypes = [
  'link',
  'text',
  'image',
  'file',
  'recording',
  'scan',
  'todo',
  'prompt-draft',
] as const satisfies readonly Mark['type'][]

export type UnifiedRecordType = typeof unifiedRecordTypes[number]
export type UnifiedRecordSelection = UnifiedRecordType | 'auto'
type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface UnifiedTodoDraft {
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
}

interface UnifiedShortcutEvent {
  key: string
  code?: string
  metaKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  isComposing?: boolean
}

export function classifyUnifiedRecordInput(value: string): 'link' | 'text' {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return 'text'

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? 'link' : 'text'
  } catch {
    return 'text'
  }
}

export function resolveUnifiedRecordType(
  selection: UnifiedRecordSelection,
  value: string,
): UnifiedRecordType {
  return selection === 'auto' ? classifyUnifiedRecordInput(value) : selection
}

export function resolveUnifiedTodoDraft(value: string, todo: UnifiedTodoDraft): UnifiedTodoDraft {
  const draft = value.trim()
  const title = todo.title.trim()
  const description = todo.description.trim()

  if (!title) {
    const [firstLine = '', ...rest] = draft.split('\n')
    const remainder = rest.join('\n').trim()
    return {
      title: firstLine.trim(),
      description: [description, remainder].filter(Boolean).join('\n\n'),
      priority: todo.priority,
    }
  }

  return {
    title,
    description: [description, draft].filter(Boolean).join('\n\n'),
    priority: todo.priority,
  }
}

export function normalizeUnifiedLinkUrl(value: string): string {
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function resolveUnifiedRecordShortcut(
  event: UnifiedShortcutEvent,
  platform: Platform,
): UnifiedRecordSelection | null {
  if (platform === 'unknown' || event.repeat || event.isComposing || event.shiftKey) return null

  const usesPlatformModifier = platform === 'macos'
    ? Boolean(event.metaKey) && !event.ctrlKey && !event.altKey
    : Boolean(event.altKey) && !event.ctrlKey && !event.metaKey
  if (!usesPlatformModifier) return null

  // 注音等輸入法下 key 可能不是數字，所以也看實體鍵位。
  const digit = /^Digit(\d)$/.exec(event.code ?? '')?.[1] ?? event.key
  if (digit === '0') return 'auto'
  const index = Number.parseInt(digit, 10) - 1
  return Number.isInteger(index) && index >= 0 && index < unifiedRecordTypes.length
    ? unifiedRecordTypes[index]
    : null
}
