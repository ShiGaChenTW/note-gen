// Fork（almanac ALMNC-54.13）：G2 專家回顧——每位專家回顧自己的領域，只提出觀察，交給指揮官（R6）。
// 觀察分兩種：一般觀察（缺口、結構、該更新的地方）放進每週回顧；衝突（過時、矛盾、情境不同、重複、封存）走清理流程
// （每週整理依 MOC 打包）。專家只讀筆記庫，不查外部資料。
import { CONTENT_EVIDENCE_RULE } from '@/lib/cleanup/detect'
import { extractJson } from '@/lib/collect/split'
import { CONFLICT_TYPES, type ConflictObservation, type ConflictType } from '@/lib/cleanup/types'
import type { AskModel, DomainDigest } from './research'

export const OBSERVATION_KINDS = ['gap', 'structure', 'stale', 'other'] as const
export type ObservationKind = typeof OBSERVATION_KINDS[number]

export interface ReviewObservation {
  kind: ObservationKind
  text: string
  notePaths: string[]
}

export interface ExpertReview {
  domainId: string
  agentId?: string
  observations: ReviewObservation[]
  conflicts: ConflictObservation[]
}

export function buildExpertReviewPrompt(digest: DomainDigest): string {
  return [
    `Review your domain "${digest.name}". You only read; report observations for the commander, do not write notes.`,
    'observations: gap (missing topic), structure (overview or grouping should change), stale (likely outdated, needs re-checking), other.',
    'conflicts: pairs of notes that are outdated / contradiction / context / duplicate, or a single obsolete note; give evidence.',
    CONTENT_EVIDENCE_RULE,
    'Use the language of the notes. Output JSON only: {"observations":[{"kind":"gap","text":"","notes":[0]}],"conflicts":[{"type":"duplicate","notes":[0,1],"evidence":"","conclusionChanged":false}]}',
    '---',
    ...digest.notes.slice(0, 60).map((note, index) => `[${index}] ${note.title}${note.summary ? ` — ${note.summary}` : ''}${note.status && note.status !== 'valid' ? ` (${note.status})` : ''}`),
  ].join('\n')
}

function paths(value: unknown, digest: DomainDigest): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(Number)
    .filter(index => Number.isInteger(index) && index >= 0 && index < digest.notes.length).map(index => digest.notes[index].path)))
}

export function parseExpertReview(raw: string, digest: DomainDigest, agentId?: string): ExpertReview {
  const parsed = extractJson(raw) as { observations?: unknown, conflicts?: unknown } | null
  const observations: ReviewObservation[] = []
  for (const item of Array.isArray(parsed?.observations) ? parsed.observations : []) {
    const record = item as Record<string, unknown>
    const text = typeof record?.text === 'string' ? record.text.trim() : ''
    if (!text) continue
    const kind = OBSERVATION_KINDS.includes(record.kind as ObservationKind) ? record.kind as ObservationKind : 'other'
    observations.push({ kind, text: Array.from(text).slice(0, 300).join(''), notePaths: paths(record.notes, digest) })
  }
  const conflicts: ConflictObservation[] = []
  for (const item of Array.isArray(parsed?.conflicts) ? parsed.conflicts : []) {
    const record = item as Record<string, unknown>
    const type = record?.type as ConflictType
    const evidence = typeof record?.evidence === 'string' ? record.evidence.trim() : ''
    const notePaths = paths(record?.notes, digest)
    if (!CONFLICT_TYPES.includes(type) || !evidence) continue
    if (type === 'obsolete' ? notePaths.length < 1 : notePaths.length < 2) continue
    conflicts.push({
      type, notePaths, evidence, domainId: digest.domainId, trigger: 'review',
      ...(type === 'outdated' ? { conclusionChanged: record.conclusionChanged === true } : {}),
      by: { role: 'expert', ...(agentId ? { agentId } : {}) },
    })
  }
  return { domainId: digest.domainId, ...(agentId ? { agentId } : {}), observations, conflicts }
}

/** 一位專家回顧一個領域；模型失敗就回傳空的回顧。 */
export async function reviewDomain(digest: DomainDigest, deps: { ask: AskModel, prompt?: string, agentId?: string }): Promise<ExpertReview> {
  if (!digest.notes.length) return { domainId: digest.domainId, observations: [], conflicts: [] }
  try {
    return parseExpertReview(await deps.ask([deps.prompt, buildExpertReviewPrompt(digest)].filter(Boolean).join('\n\n')), digest, deps.agentId)
  } catch (error) {
    console.warn('[review] expert review failed:', error)
    return { domainId: digest.domainId, ...(deps.agentId ? { agentId: deps.agentId } : {}), observations: [], conflicts: [] }
  }
}
