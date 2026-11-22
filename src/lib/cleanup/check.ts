// Fork（almanac ALMNC-54.12）：三種發現時機的比對流程——
//   1. 接受提案、新筆記寫入之後（written）
//   2. Scott 在檯面存了親手寫的筆記（handwritten）
//   3. 定期檢查：最後確認日期超過領域期限的筆記（periodic，由回顧排程呼叫）
// 加上確認卡「交給指揮官」的重新確認（recheck：必要時查外部資料；沒發現問題就提案「仍然有效」）。
// 專家比對（只讀）→ 指揮官依類型做成清理提案 → 衝突或錯誤立刻送到工作台，其餘放進佇列等每週回顧。全部注入依賴，測試用假的。
import type { ProposalBatch, SimilarNote } from '@/lib/commander/types'
import { noteTitle, parseV3Note } from '@/lib/v3-model/note'
import { ymd } from './interval'
import { cleanupProposals, confirmProposal, observationKey, routeObservations, type CleanupLabels, type DomainInfo, type NoteWords } from './plan'
import type { CleanupQueue } from './queue'
import type { ConflictDetector, ConflictObservation, ConflictTrigger, ExternalEvidence, NoteText } from './types'

export interface CheckDeps {
  readNote: (path: string) => Promise<string | null>
  /** 依領域找類似筆記（similar.ts createSimilarFinder）。 */
  similar: (domainId: string | undefined, query: { title: string, body: string }, exclude: readonly string[], scope?: { allDomains?: boolean }) => Promise<SimilarNote[]>
  detect: ConflictDetector
  domains: () => Promise<DomainInfo[]>
  /** 負責這個領域的專家：固定編號與工作指示＋個別記憶。沒有專家時由指揮官比對。 */
  expertFor?: (domainId: string) => Promise<{ agentId: string, prompt: string } | undefined>
  /** 指揮官的工作指示（沒有專家的領域、重新確認時用）。 */
  commanderPrompt?: () => Promise<string>
  /** 指揮官查外部資料（研究員的網路搜尋）；只有重新確認時用。沒有或失敗就只比對筆記庫。 */
  lookup?: (query: string) => Promise<ExternalEvidence[]>
  submit: (batch: ProposalBatch) => Promise<void>
  queue: CleanupQueue
  labels: CleanupLabels
  words?: NoteWords
  commanderName?: string
  now?: () => Date
}

export interface CheckResult {
  status: 'skipped' | 'checked'
  reason?: 'not_found' | 'inactive'
  observations: ConflictObservation[]
  immediate: ConflictObservation[]
  deferred: ConflictObservation[]
  batch?: ProposalBatch
}

const SKIPPED = (reason: CheckResult['reason']): CheckResult => ({ status: 'skipped', reason, observations: [], immediate: [], deferred: [] })

export function toNoteText(path: string, raw: string): NoteText {
  const parsed = parseV3Note(raw)
  return { path, raw, body: parsed.body, fields: parsed.fields, title: noteTitle(parsed, path) }
}

async function readTexts(paths: readonly string[], deps: Pick<CheckDeps, 'readNote'>): Promise<NoteText[]> {
  const out: NoteText[] = []
  for (const path of paths) {
    try {
      const raw = await deps.readNote(path)
      if (raw !== null) out.push(toNoteText(path, raw))
    } catch {
      // 讀不到的類似筆記就不比對。
    }
  }
  return out
}

async function compare(note: NoteText, trigger: ConflictTrigger, deps: CheckDeps, external?: ExternalEvidence[]): Promise<{ observations: ConflictObservation[], texts: NoteText[] }> {
  const today = ymd(deps.now?.() ?? new Date())
  const scopes: Array<string | undefined> = note.fields.domains.length ? note.fields.domains : [undefined]
  const observations: ConflictObservation[] = []
  const texts = new Map<string, NoteText>([[note.path, note]])
  for (const domainId of scopes) {
    const similar = await deps.similar(domainId, { title: note.title, body: note.body }, [note.path], domainId ? {} : { allDomains: true }).catch(() => [])
    const candidates = await readTexts(similar.map(entry => entry.path).filter(path => path !== note.path), deps)
    for (const candidate of candidates) texts.set(candidate.path, candidate)
    if (!candidates.length && !external?.length) continue
    const expert = domainId ? await deps.expertFor?.(domainId).catch(() => undefined) : undefined
    const prompt = expert?.prompt ?? await deps.commanderPrompt?.().catch(() => undefined)
    const found = await deps.detect(note, candidates, {
      trigger,
      domainId,
      today,
      agentPrompt: prompt,
      external,
      by: expert ? { role: 'expert', agentId: expert.agentId } : { role: 'commander' },
    })
    observations.push(...found)
  }
  const seen = new Set<string>()
  return {
    observations: observations.filter(observation => {
      const key = observationKey(observation)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
    texts: [...texts.values()],
  }
}

function batchOf(id: string, origin: string, proposals: ProposalBatch['proposals']): ProposalBatch | undefined {
  return proposals.length ? { id, origin, proposals } : undefined
}

async function domainMap(deps: Pick<CheckDeps, 'domains'>): Promise<Map<string, DomainInfo>> {
  try {
    return new Map((await deps.domains()).map(domain => [domain.id, domain]))
  } catch {
    return new Map()
  }
}

/** 立刻提出的觀察做成提案批次並送出。批次 id 以時機＋筆記＋日期為準，同一天重跑不會重複送。 */
export async function submitImmediate(
  observations: readonly ConflictObservation[],
  texts: readonly NoteText[],
  deps: Pick<CheckDeps, 'readNote' | 'domains' | 'submit' | 'labels' | 'words' | 'commanderName' | 'now'>,
  id: string,
): Promise<ProposalBatch | undefined> {
  if (!observations.length) return undefined
  const notes = new Map(texts.map(text => [text.path, text.raw]))
  // 觀察裡提到、但還沒讀過的筆記補讀。
  for (const path of new Set(observations.flatMap(observation => observation.notePaths))) {
    if (notes.has(path)) continue
    const raw = await deps.readNote(path).catch(() => null)
    if (raw !== null) notes.set(path, raw)
  }
  const proposals = cleanupProposals(observations, {
    notes,
    domains: await domainMap(deps),
    today: ymd(deps.now?.() ?? new Date()),
    labels: deps.labels,
    words: deps.words,
    immediate: true,
  })
  const batch = batchOf(id, deps.labels.origin({ agent: deps.commanderName ?? '' }), proposals)
  if (batch) await deps.submit(batch)
  return batch
}

/** 時機 1～3：比對一則筆記。衝突或錯誤立刻提案，其餘進佇列。 */
export async function checkNote(path: string, trigger: Exclude<ConflictTrigger, 'recheck' | 'review'>, deps: CheckDeps): Promise<CheckResult> {
  const raw = await deps.readNote(path)
  if (raw === null) return SKIPPED('not_found')
  const note = toNoteText(path, raw)
  if (note.fields.status === 'superseded' || note.fields.status === 'archived') return SKIPPED('inactive')
  const { observations, texts } = await compare(note, trigger, deps)
  const { immediate, deferred } = routeObservations(observations)
  const today = ymd(deps.now?.() ?? new Date())
  const batch = await submitImmediate(immediate, texts, deps, `cleanup:${trigger}:${path}:${today}`)
  if (deferred.length) await deps.queue.add(deferred)
  return { status: 'checked', observations, immediate, deferred, batch }
}

/**
 * 確認卡「交給指揮官」：指揮官重新確認（比對筆記庫＋查外部資料）。Scott 主動要求，所以發現什麼都立刻提案；
 * 什麼都沒發現就提案「仍然有效」（接受後最後確認日期改成今天）。
 */
export async function recheckNote(path: string, deps: CheckDeps): Promise<CheckResult> {
  const raw = await deps.readNote(path)
  if (raw === null) return SKIPPED('not_found')
  const note = toNoteText(path, raw)
  let external: ExternalEvidence[] = []
  if (deps.lookup) {
    try {
      external = (await deps.lookup(note.title)).slice(0, 5)
    } catch (error) {
      console.warn('[cleanup] external lookup failed:', error)
    }
  }
  const { observations, texts } = await compare(note, 'recheck', deps, external)
  const today = ymd(deps.now?.() ?? new Date())
  const id = `cleanup:recheck:${path}:${today}`
  let batch = await submitImmediate(observations, texts, deps, id)
  if (!batch) {
    const evidence = external.length ? external.map(item => item.url).join('、') : ''
    batch = batchOf(id, deps.labels.origin({ agent: deps.commanderName ?? '' }), [confirmProposal(path, raw, { today, labels: deps.labels, evidence })])!
    await deps.submit(batch)
  }
  return { status: 'checked', observations, immediate: observations, deferred: [], batch }
}

/** 時機 3：定期檢查到期的筆記（每次最多 limit 則，舊的先）。 */
export async function periodicCheck(paths: readonly string[], deps: CheckDeps, options: { limit?: number } = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const path of paths.slice(0, options.limit ?? 10)) {
    try {
      results.push(await checkNote(path, 'periodic', deps))
    } catch (error) {
      console.warn('[cleanup] periodic check failed:', path, error)
    }
  }
  return results
}
