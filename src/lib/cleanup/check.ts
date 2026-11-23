// Fork（almanac ALMNC-54.12）：三種發現時機的比對流程——
//   1. 接受提案、新筆記寫入之後（written）
//   2. Scott 在檯面存了親手寫的筆記（handwritten）
//   3. 定期檢查：最後確認日期超過領域期限的筆記（periodic，由回顧排程呼叫）
// 加上確認卡「交給指揮官」的重新確認（recheck：必要時查外部資料；沒發現問題就提案「仍然有效」）。
// 專家比對（只讀），觀察進佇列等每週整理。
import { contentVersion } from '@/lib/ops/version'
import type { ProposalBatch, SimilarNote } from '@/lib/commander/types'
import { noteTitle, parseV3Note } from '@/lib/v3-model/note'
import { canonicalDomainIds, domainLookup } from '@/lib/v3-model/domain'
import { ymd } from './interval'
import { confirmProposal, type CleanupLabels, type DomainInfo, type NoteWords } from './plan'
import { queuedKey, type CleanupQueue } from './queue'
import type { ConflictDetector, ConflictObservation, ConflictTrigger, ExternalEvidence, NoteText } from './types'

export interface CheckDeps {
  readNote: (path: string) => Promise<string | null>
  /** 依領域找類似筆記（similar.ts createSimilarFinder）。 */
  similar: (domainId: string | undefined, query: { title: string, body: string }, exclude: readonly string[], scope?: { allDomains?: boolean, domainRefs?: readonly string[] }) => Promise<SimilarNote[]>
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
  deferred: ConflictObservation[]
  batch?: ProposalBatch
}

const SKIPPED = (reason: CheckResult['reason']): CheckResult => ({ status: 'skipped', reason, observations: [], deferred: [] })

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

async function compare(note: NoteText, trigger: ConflictTrigger, deps: CheckDeps, external?: ExternalEvidence[]): Promise<ConflictObservation[]> {
  // Fork（almanac ALMNC-69.4）：筆記 domains 存領域名稱（舊資料是 dom_ id），先換成領域 id；找類似筆記時兩種寫法都比。
  const lookup = await domainMap(deps)
  const domainIds = canonicalDomainIds(note.fields.domains, lookup)
  const scopes: Array<string | undefined> = domainIds.length ? domainIds : [undefined]
  const observations: ConflictObservation[] = []
  for (const domainId of scopes) {
    const domain = domainId ? lookup.get(domainId) : undefined
    const scope = domainId ? (domain ? { domainRefs: [domain.id, domain.name] } : {}) : { allDomains: true }
    const similar = await deps.similar(domainId, { title: note.title, body: note.body }, [note.path], scope).catch(() => [])
    const candidates = await readTexts(similar.map(entry => entry.path).filter(path => path !== note.path), deps)
    if (!candidates.length && !external?.length) continue
    const expert = domainId ? await deps.expertFor?.(domainId).catch(() => undefined) : undefined
    const prompt = expert?.prompt ?? await deps.commanderPrompt?.().catch(() => undefined)
    const found = await deps.detect(note, candidates, {
      trigger,
      domainId,
      agentPrompt: prompt,
      external,
      by: expert ? { role: 'expert', agentId: expert.agentId } : { role: 'commander' },
    })
    const versions = new Map([note, ...candidates].map(text => [text.path, contentVersion(text.raw)!]))
    observations.push(...found.map(observation => ({
      ...observation,
      observedVersions: Object.fromEntries(observation.notePaths.flatMap(path => {
        const version = versions.get(path)
        return version ? [[path, version]] : []
      })),
    })))
  }
  const seen = new Set<string>()
  return observations.filter(observation => {
    const key = queuedKey(observation)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function domainMap(deps: Pick<CheckDeps, 'domains'>): Promise<Map<string, DomainInfo>> {
  try {
    // id 與名稱都當 key（筆記 domains 過渡期兩種寫法都有）；取出來的 domain.id 才是領域 id。
    return domainLookup(await deps.domains())
  } catch {
    return new Map()
  }
}

/** 比對一則筆記；所有觀察等每週整理時一起審核。 */
export async function checkNote(path: string, trigger: Exclude<ConflictTrigger, 'recheck' | 'review'>, deps: CheckDeps): Promise<CheckResult> {
  const raw = await deps.readNote(path)
  if (raw === null) return SKIPPED('not_found')
  const note = toNoteText(path, raw)
  if (note.fields.status === 'superseded' || note.fields.status === 'archived') return SKIPPED('inactive')
  const observations = await compare(note, trigger, deps)
  if (observations.length) await deps.queue.add(observations)
  return { status: 'checked', observations, deferred: observations }
}

/**
 * 確認卡「交給指揮官」：指揮官重新確認（比對筆記庫＋查外部資料）。有發現就納入每週整理；
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
  const observations = await compare(note, 'recheck', deps, external)
  if (observations.length) {
    await deps.queue.add(observations)
    return { status: 'checked', observations, deferred: observations }
  }
  const today = ymd(deps.now?.() ?? new Date())
  const evidence = external.map(item => item.url).join('、')
  const batch = {
    id: `cleanup:recheck:${path}:${today}`,
    origin: deps.labels.origin({ agent: deps.commanderName ?? '' }),
    proposals: [confirmProposal(path, raw, { today, labels: deps.labels, evidence })],
  }
  await deps.submit(batch)
  return { status: 'checked', observations, deferred: [], batch }
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
