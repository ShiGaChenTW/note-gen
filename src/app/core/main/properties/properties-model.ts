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
