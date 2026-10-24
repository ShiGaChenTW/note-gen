import { AlignLeft, List, Binary, CheckSquare, Calendar, Clock, Hash, Users, FileCode } from 'lucide-react'
import { listProperties, type PropertyType } from '@/lib/markdown/frontmatter-edit'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'

export const propertyIcons = { text: AlignLeft, multitext: List, number: Binary, checkbox: CheckSquare, date: Calendar, datetime: Clock, tags: Hash, aliases: Users, unsupported: FileCode }

export function propertiesForArticle(content: string, types: Record<string, PropertyType>) {
  return listProperties(splitFrontmatter(content).block, types)
}

export function rankPropertyKeys(notes: Iterable<{ frontmatter: Record<string, unknown> | null }>, query = ''): string[] {
  const counts = new Map<string, number>()
  for (const note of notes) for (const key of Object.keys(note.frontmatter ?? {})) {
    if (key.toLocaleLowerCase().includes(query.toLocaleLowerCase())) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key)
}

export function initialPropertyValue(type: PropertyType): unknown {
  if (['multitext', 'tags', 'aliases'].includes(type)) return []
  if (type === 'number') return 0
  if (type === 'checkbox') return false
  return ''
}

export function chipValues(value: unknown): string[] {
  return (Array.isArray(value) ? value : value == null ? [] : [value]).map(String)
}

export function yamlSourceOf(content: string): string {
  const { block } = splitFrontmatter(content)
  if (!block) return ''
  return block.replace(/^\uFEFF?[^\r\n]*(?:\r\n|\n|\r)/, '').replace(/(?:^|\r\n|\n|\r)[\t ]*(?:---|\.\.\.)[\t ]*(?:\r\n|\n|\r)?$/, '')
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** 閱讀模式的日期文字：依介面語系輸出；格式不符或日期不存在時原樣回傳。 */
export function formatPropertyDate(value: unknown, locale: string): string {
  const text = String(value ?? '')
  const match = DATE_RE.exec(text)
  if (!match) return text
  const [year, month, day, hour, minute, second] = match.slice(1).map(part => (part === undefined ? undefined : Number(part)))
  const date = new Date(year!, month! - 1, day!, hour ?? 0, minute ?? 0, second ?? 0)
  if (date.getFullYear() !== year || date.getMonth() !== month! - 1 || date.getDate() !== day) return text
  try {
    return new Intl.DateTimeFormat(locale, hour === undefined ? { dateStyle: 'long' } : { dateStyle: 'long', timeStyle: 'short' }).format(date)
  } catch { return text }
}

/** 其他筆記在這個 key 用過的純量值，依出現次數排序；排除目前這篇、限制筆數。 */
export function suggestPropertyValues(
  notes: Iterable<{ path?: string; frontmatter: Record<string, unknown> | null }>,
  key: string,
  excludePath = '',
  limit = 12,
): string[] {
  const counts = new Map<string, number>()
  for (const note of notes) {
    if (excludePath && note.path === excludePath) continue
    const value = note.frontmatter?.[key]
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const text = String(value)
    if (!text.trim() || text.length > 80 || /[\r\n]/.test(text)) continue
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([text]) => text)
}
