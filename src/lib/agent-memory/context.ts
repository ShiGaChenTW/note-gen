// Fork（almanac ALMNC-54.3）：共用工作記憶的「目前脈絡」——進行中的專案、本週重點、常出現的人。
// 只放名稱和連結，不放事情本身（進度、決策、時間都在筆記與行動裡）。
// 上限：專案最多 10 個、本週重點最多 5 項，超過就拒絕，不會自動截掉。
export const CONTEXT_MAX_PROJECTS = 10
export const CONTEXT_MAX_FOCUS = 5
export const CONTEXT_MAX_PEOPLE = 20
export const CONTEXT_TITLE_MAX = 80

export interface ContextItem {
  title: string
  link?: string
}

export interface SharedContext {
  projects: ContextItem[]
  weeklyFocus: ContextItem[]
  people: string[]
}

export interface SavedSharedContext extends SharedContext {
  updatedAt: number | null
  updatedBy: string | null
}

export const EMPTY_CONTEXT: SharedContext = { projects: [], weeklyFocus: [], people: [] }

export type ContextValidationError =
  | 'TOO_MANY_PROJECTS'
  | 'TOO_MANY_FOCUS'
  | 'TOO_MANY_PEOPLE'
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'

function normalizeItems(items: readonly ContextItem[]): ContextItem[] | ContextValidationError {
  const result: ContextItem[] = []
  for (const item of items) {
    const title = item.title?.trim() ?? ''
    if (!title) return 'TITLE_REQUIRED'
    if ([...title].length > CONTEXT_TITLE_MAX) return 'TITLE_TOO_LONG'
    const link = item.link?.trim()
    result.push(link ? { title, link } : { title })
  }
  return result
}

export function validateSharedContext(context: SharedContext):
  { ok: true, context: SharedContext } | { ok: false, error: ContextValidationError } {
  if (context.projects.length > CONTEXT_MAX_PROJECTS) return { ok: false, error: 'TOO_MANY_PROJECTS' }
  if (context.weeklyFocus.length > CONTEXT_MAX_FOCUS) return { ok: false, error: 'TOO_MANY_FOCUS' }
  const people = context.people.map(person => person.trim()).filter(Boolean)
  if (people.length > CONTEXT_MAX_PEOPLE) return { ok: false, error: 'TOO_MANY_PEOPLE' }
  if (people.some(person => [...person].length > CONTEXT_TITLE_MAX)) return { ok: false, error: 'TITLE_TOO_LONG' }
  const projects = normalizeItems(context.projects)
  if (typeof projects === 'string') return { ok: false, error: projects }
  const weeklyFocus = normalizeItems(context.weeklyFocus)
  if (typeof weeklyFocus === 'string') return { ok: false, error: weeklyFocus }
  return { ok: true, context: { projects, weeklyFocus, people: [...new Set(people)] } }
}

/** 設定頁的文字框：一行一項，「標題 | 連結」，連結可省略。空行略過。 */
export function parseContextLines(text: string): ContextItem[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const index = line.lastIndexOf('|')
    if (index < 0) return { title: line }
    const title = line.slice(0, index).trim()
    const link = line.slice(index + 1).trim()
    return link ? { title, link } : { title }
  })
}

export function formatContextLines(items: readonly ContextItem[]): string {
  return items.map(item => item.link ? `${item.title} | ${item.link}` : item.title).join('\n')
}

/** 資料庫裡的 JSON 讀回來時，格式不對的項目直接略過。 */
export function parseStoredItems(json: string | null | undefined): ContextItem[] {
  try {
    const value: unknown = JSON.parse(json ?? '[]')
    if (!Array.isArray(value)) return []
    return value.flatMap(item => {
      if (typeof item !== 'object' || item === null || typeof (item as ContextItem).title !== 'string') return []
      const { title, link } = item as ContextItem
      return [typeof link === 'string' && link ? { title, link } : { title }]
    })
  } catch {
    return []
  }
}

export function parseStoredPeople(json: string | null | undefined): string[] {
  try {
    const value: unknown = JSON.parse(json ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
