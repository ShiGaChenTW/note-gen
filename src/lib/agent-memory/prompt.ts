// Fork（almanac ALMNC-54.3）：把個別記憶、Scott 的偏好和目前脈絡（只有標題）放進 agent 的系統提示。
// 每段都截短，避免記憶越寫越長把提示撐爆。
import type { SharedContext } from './context'

export const PROMPT_SECTION_MAX = 2000

export interface MemoryPromptInput {
  soul: string
  rules: string
  workNotes: string
  scottPreferences: string
  context: SharedContext
}

export function trimForPrompt(text: string, max = PROMPT_SECTION_MAX): string {
  const chars = [...text.trim()]
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}\n…(truncated)`
}

export function buildMemoryPrompt(input: MemoryPromptInput): string {
  const sections: string[] = []
  const add = (title: string, body: string) => {
    const trimmed = trimForPrompt(body)
    if (trimmed) sections.push(`## ${title}\n${trimmed}`)
  }
  add('Your identity (soul.md)', input.soul)
  add('Your working rules (rules.md)', input.rules)
  add('Your work notes', input.workNotes)
  add('Scott\'s preferences (shared by all agents; only Scott edits them)', input.scottPreferences)
  const { projects, weeklyFocus, people } = input.context
  const contextLines = [
    projects.length ? `Active projects: ${projects.map(item => item.title).join('; ')}` : '',
    weeklyFocus.length ? `This week's focus: ${weeklyFocus.map(item => item.title).join('; ')}` : '',
    people.length ? `People who come up often: ${people.join(', ')}` : '',
  ].filter(Boolean)
  if (contextLines.length) {
    add('Current context (titles only)', contextLines.join('\n'))
  }
  if (!sections.length) return ''
  return [
    ...sections,
    'Shared working memory is not a citation source: answer Scott from notes only. When memory and notes disagree, the notes win.',
  ].join('\n\n')
}
