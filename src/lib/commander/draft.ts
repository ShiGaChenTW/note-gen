// Fork（almanac ALMNC-54.6）：C1～C3 撰寫。每位負責的角色一次拿到分給它的片段，用自己的工作指示＋個別記憶撰寫草稿。
// 草稿只交回指揮官統整，不寫筆記庫。模型失敗或漏寫某一段時，那一段直接用片段內容（標成 fallback），內容不會掉；
// 保底片段本身也不交給模型改寫。
// 規格：專家撰寫知識筆記草稿時用和指揮官同級的模型——這裡兩者都走同一個 ask，所以自然同級。
import { extractJson, isValidYmd, normalizeTime } from '@/lib/collect/split'
import type { Assignment, AskModel, Draft, Fragment, RosterAgent, SimilarNote } from './types'

export interface DraftDeps {
  ask: AskModel
  roster: readonly RosterAgent[]
  agentPrompt: (agent: RosterAgent | undefined, role: Draft['role']) => Promise<string>
  findSimilarNotes?: (domainId: string | undefined, fragment: Fragment) => Promise<SimilarNote[]>
}

const ROLE_OF: Record<Draft['lane'], Draft['role']> = { C1: 'expert', C2: 'commander', C3: 'secretary' }

interface Group {
  lane: Draft['lane']
  agentId?: string
  items: Assignment[]
}

function groupByAssignee(assignments: readonly Assignment[]): Group[] {
  const groups = new Map<string, Group>()
  for (const assignment of assignments) {
    if (assignment.lane === 'reject') continue
    const key = `${assignment.lane}:${assignment.agentId ?? ''}`
    const group = groups.get(key) ?? { lane: assignment.lane, agentId: assignment.agentId, items: [] }
    group.items.push(assignment)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function describeFragment(assignment: Assignment, similar: SimilarNote[] | 'unavailable' | undefined): string {
  const { fragment } = assignment
  const context = [
    fragment.noteType ? `noteType=${fragment.noteType}` : `kind=${fragment.kind}`,
    fragment.date ? `date=${fragment.date}` : '',
    fragment.time ? `time=${fragment.time}` : '',
    fragment.people.length ? `people=${fragment.people.join(', ')}` : '',
    fragment.project ? `project=${fragment.project}` : '',
    fragment.domainHint ? `domain=${fragment.domainHint}` : '',
  ].filter(Boolean).join('; ')
  const lines = [`### index ${fragment.index} (${context})`, `title: ${fragment.title}`, fragment.body]
  if (Array.isArray(similar) && similar.length) {
    lines.push(`Similar notes in this domain (compare, point out duplicates or conflicts): ${similar.map(note => `${note.title} (${note.path})`).join('; ')}`)
  }
  return lines.join('\n')
}

export function buildDraftPrompt(lane: Draft['lane'], items: readonly Assignment[], similar: Map<number, SimilarNote[] | 'unavailable'>): string {
  const task = lane === 'C3'
    ? 'Turn each piece into a task or calendar entry. Return title (starts with a verb), date (YYYY-MM-DD, only if known) and time (HH:mm, only for timed entries).'
    : lane === 'C1'
      ? 'Write a knowledge note draft for each piece: one idea per note, title as one sentence, body organised in Markdown (not a copy of the source). Compare with the similar notes listed and mention duplicates or conflicts in the body.'
      : 'Write a note draft for each piece, keeping its noteType: knowledge = one timeless idea, title as one sentence; record = one dated event; project = one ongoing effort. Body organised in Markdown, not a copy of the source.'
  return [
    task,
    'Use the language of the source. Do not invent facts. These drafts go back to the commander and become proposals for Scott; nothing is written to the vault now.',
    'Output JSON only, no explanation or code fence: {"drafts":[{"index":0,"title":"","body":"","date":"","time":""}]}',
    '---',
    ...items.map(item => describeFragment(item, similar.get(item.fragment.index))),
  ].join('\n')
}

interface ParsedDraft {
  title: string
  body: string
  date?: string
  time?: string
}

/** 解析模型的草稿；只收認得的 index，格式不對的欄位丟掉（之後退回片段內容）。 */
export function parseDrafts(raw: string): Map<number, ParsedDraft> {
  const parsed = extractJson(raw)
  const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { drafts?: unknown } | null)?.drafts
  const out = new Map<number, ParsedDraft>()
  if (!Array.isArray(list)) return out
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const index = typeof record.index === 'number' ? record.index : Number(record.index)
    if (!Number.isInteger(index) || out.has(index)) continue
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (!title) continue
    const date = typeof record.date === 'string' && isValidYmd(record.date.trim()) ? record.date.trim() : undefined
    const time = typeof record.time === 'string' ? normalizeTime(record.time) || undefined : undefined
    out.set(index, { title, body: typeof record.body === 'string' ? record.body.trim() : '', date, time })
  }
  return out
}

function toDraft(group: Group, assignment: Assignment, written: ParsedDraft | undefined, similar: SimilarNote[] | 'unavailable' | undefined): Draft {
  const { fragment } = assignment
  const role = ROLE_OF[group.lane]
  const date = written?.date ?? fragment.date
  const time = written?.time ?? fragment.time
  const kind: Draft['kind'] = group.lane !== 'C3' ? 'note' : date && time ? 'event' : 'task'
  return {
    fragment,
    lane: group.lane,
    role,
    ...(group.agentId ? { agentId: group.agentId } : {}),
    kind,
    ...(kind === 'note' ? { noteType: fragment.noteType ?? 'record' } : {}),
    title: written?.title || fragment.title,
    body: kind === 'note' ? (written?.body || fragment.body) : '',
    ...(date ? { date } : {}),
    ...(kind === 'event' && time ? { time } : {}),
    people: fragment.people,
    ...(fragment.project ? { project: fragment.project } : {}),
    domainIds: assignment.domainId ? [assignment.domainId] : [],
    tags: fragment.tags,
    meta: {
      writtenBy: written ? 'ai' : 'fallback',
      ...(group.lane === 'C1' ? { similarNotes: similar ?? 'unavailable' } : {}),
    },
  }
}

async function similarFor(group: Group, deps: DraftDeps): Promise<Map<number, SimilarNote[] | 'unavailable'>> {
  const out = new Map<number, SimilarNote[] | 'unavailable'>()
  if (group.lane !== 'C1') return out
  for (const item of group.items) {
    if (!deps.findSimilarNotes) {
      out.set(item.fragment.index, 'unavailable')
      continue
    }
    try {
      out.set(item.fragment.index, await deps.findSimilarNotes(item.domainId, item.fragment))
    } catch {
      out.set(item.fragment.index, 'unavailable')
    }
  }
  return out
}

/** 每位負責的角色各撰寫一次，回傳和輸入同順序的草稿（不含不採用的片段）。 */
export async function draft(assignments: readonly Assignment[], deps: DraftDeps): Promise<Draft[]> {
  const drafts = new Map<number, Draft>()
  for (const group of groupByAssignee(assignments)) {
    const agent = deps.roster.find(entry => entry.id === group.agentId)
    const similar = await similarFor(group, deps)
    // 保底片段（拆分失敗或轉不出文字）不再交給模型改寫，原文原封不動留給 Scott 看。
    const toWrite = group.items.filter(item => !item.fragment.fallback)
    let written = new Map<number, ParsedDraft>()
    if (toWrite.length) {
      try {
        const system = await deps.agentPrompt(agent, ROLE_OF[group.lane])
        const prompt = [system, buildDraftPrompt(group.lane, toWrite, similar)].filter(Boolean).join('\n\n')
        written = parseDrafts(await deps.ask(prompt))
      } catch (error) {
        console.warn('[commander] draft failed, using fragment content:', error)
      }
    }
    for (const item of group.items) {
      drafts.set(item.fragment.index, toDraft(group, item, written.get(item.fragment.index), similar.get(item.fragment.index)))
    }
  }
  return assignments.filter(item => item.lane !== 'reject').map(item => drafts.get(item.fragment.index)!).filter(Boolean)
}
