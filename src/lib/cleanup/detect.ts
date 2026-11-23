// Fork（almanac ALMNC-54.12）：專家端的比對——一則筆記對上同領域的類似筆記，找出過時、矛盾、情境不同、重複。
// 專家只讀、只提出觀察（不改筆記、不決定怎麼處理）；模型藏在 ask 後面，測試用假的。
// 模型壞掉、輸出不合格時回傳空清單，不假裝比對過也不擋住寫入。
import { extractJson } from '@/lib/collect/split'
import { CONFLICT_TYPES, type ConflictObservation, type ConflictType, type DetectOptions, type NoteText } from './types'

export type AskModel = (prompt: string) => Promise<string>

export const CONTENT_EVIDENCE_RULE = 'Never use dates, last-confirmed timestamps, file age, or identity numbers as evidence that a claim is newer or outdated. Cite the actual change in content or source evidence. When the evidence does not settle a disagreement, report a contradiction for verification.'

const BODY_MAX = 1500

function describe(index: number, note: NoteText): string {
  const meta = [
    note.fields.status ? `status=${note.fields.status}` : '',
    note.fields.sources.length ? `sources=${note.fields.sources.length}` : '',
  ].filter(Boolean).join('; ')
  return [`### [${index}] ${note.title} (${note.path}${meta ? `; ${meta}` : ''})`, Array.from(note.body.trim()).slice(0, BODY_MAX).join('')].join('\n')
}

export function buildDetectPrompt(note: NoteText, candidates: readonly NoteText[], options: DetectOptions): string {
  const external = options.external ?? []
  return [
    'You are the domain expert. Compare note [0] with the other notes (and external evidence, if any). Only report observations; do not rewrite anything unless asked below.',
    'Types: outdated = was true, now superseded by newer information (say whether the conclusion changed: conclusionChanged true/false; first index is the outdated note, second the newer one if it exists);',
    'contradiction = two notes disagree and you cannot tell which is right; context = both are right under different conditions (give one sentence of conditions per note in "contexts"); duplicate = the same thing written twice (first index is the note to keep);',
    'obsolete = no longer relevant at all (archive).',
    'For outdated or duplicate you may give "revisedBody": the corrected or merged Markdown body, keeping every fact and source. Do not invent facts.',
    CONTENT_EVIDENCE_RULE,
    'Report nothing when the notes are merely related. Use the language of the notes.',
    'Output JSON only, no explanation or code fence: {"observations":[{"type":"outdated|contradiction|context|duplicate|obsolete","notes":[0,1],"evidence":"","conclusionChanged":false,"revisedBody":"","contexts":{"0":"","1":""},"external":[0]}]}',
    '---',
    describe(0, note),
    ...candidates.map((candidate, index) => describe(index + 1, candidate)),
    ...(external.length ? ['--- external evidence', ...external.map((item, index) => `(${index}) ${item.title} <${item.url}>\n${item.snippet}`)] : []),
  ].join('\n')
}

const PAIR_TYPES: ReadonlySet<ConflictType> = new Set(['contradiction', 'context', 'duplicate'])

/** 解析模型輸出；只收認得的類型、存在的編號、有證據的觀察。 */
export function parseObservations(raw: string, note: NoteText, candidates: readonly NoteText[], options: DetectOptions): ConflictObservation[] {
  const parsed = extractJson(raw)
  const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { observations?: unknown } | null)?.observations
  if (!Array.isArray(list)) return []
  const all = [note, ...candidates]
  const external = options.external ?? []
  const out: ConflictObservation[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const type = record.type as ConflictType
    if (!CONFLICT_TYPES.includes(type)) continue
    const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : ''
    if (!evidence) continue
    const indexes = (Array.isArray(record.notes) ? record.notes : []).filter((index): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < all.length)
    const notePaths = Array.from(new Set(indexes.map(index => all[index].path)))
    if (!notePaths.length || !notePaths.includes(options.anchor ?? note.path)) continue
    // 兩則之間的關係至少要兩則；過時只有一則時要有外部證據。
    if (PAIR_TYPES.has(type) && notePaths.length < 2) continue
    const externalUrls = (Array.isArray(record.external) ? record.external : []).map(Number)
      .filter(index => Number.isInteger(index) && index >= 0 && index < external.length).map(index => external[index].url)
    if (type === 'outdated' && notePaths.length < 2 && !externalUrls.length) continue
    const key = `${type}|${[...notePaths].sort().join('|')}`
    if (seen.has(key)) continue
    seen.add(key)
    const contexts: Record<string, string> = {}
    if (record.contexts && typeof record.contexts === 'object') {
      for (const [index, text] of Object.entries(record.contexts as Record<string, unknown>)) {
        const target = all[Number(index)]
        if (target && typeof text === 'string' && text.trim()) contexts[target.path] = text.trim()
      }
    }
    const revisedBody = typeof record.revisedBody === 'string' && record.revisedBody.trim() ? record.revisedBody.trim() : undefined
    out.push({
      type,
      notePaths,
      evidence: Array.from(evidence).slice(0, 500).join(''),
      ...(type === 'outdated' ? { conclusionChanged: record.conclusionChanged === true } : {}),
      ...(revisedBody ? { revisedBody } : {}),
      ...(Object.keys(contexts).length ? { contexts } : {}),
      ...(externalUrls.length ? { externalUrls } : {}),
      ...(options.domainId ? { domainId: options.domainId } : {}),
      ...(options.by ? { by: options.by } : {}),
      trigger: options.trigger,
    })
  }
  return out
}

/** 專家比對。沒有類似筆記也沒有外部證據時不叫模型。 */
export function createConflictDetector(ask: AskModel) {
  return async (note: NoteText, candidates: readonly NoteText[], options: DetectOptions): Promise<ConflictObservation[]> => {
    const others = candidates.filter(candidate => candidate.path !== note.path)
    if (!others.length && !options.external?.length) return []
    try {
      const prompt = [options.agentPrompt, buildDetectPrompt(note, others, options)].filter(Boolean).join('\n\n')
      return parseObservations(await ask(prompt), note, others, options)
    } catch (error) {
      console.warn('[cleanup] conflict detection failed:', error)
      return []
    }
  }
}
