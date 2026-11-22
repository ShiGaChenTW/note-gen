// Fork（almanac ALMNC-54.6）：同一主題累積 3 則以上未歸屬的知識筆記時，指揮官提案成立新領域，同時提案新增一位負責的專家
// （提議本名、領域，並起草 soul.md 與 rules.md）。規格見定案文件第一節 §3「領域」、第二節「擬人化」。
// domainProposal 是純函式；acceptDomainProposal 在 Scott 接受後才建立領域、專家並把筆記歸入，所有寫入都由依賴注入。
import { defaultInterval, formatInterval } from '@/lib/cleanup/interval'
import { defaultRules, defaultSoul } from '@/lib/agent-memory/templates'
import type { Domain } from '@/lib/v3-model/domain'
import type { NoteType } from '@/lib/v3-model/note'
import { normalizeDomainName } from './assign'
import type { RosterAgent } from './types'

export const DOMAIN_PROPOSAL_THRESHOLD = 3

/** 提議的專家本名（Scott 之後可以改）；跳過名單裡已經用掉的。 */
export const EXPERT_NAME_POOL = ['Alex', 'Ivy', 'Owen', 'Ruby', 'Theo', 'Zoe', 'Ezra', 'Maya', 'Finn', 'Iris'] as const

/** 已接受、寫進筆記庫的筆記（從 frontmatter 讀出來的）。 */
export interface KnowledgeNoteLike {
  path: string
  title: string
  type?: NoteType
  /** frontmatter 的 domains（領域 id）。 */
  domains: readonly string[]
  tags: readonly string[]
  /** 指揮官分析時猜的領域名稱；沒有就用第一個標籤當主題。 */
  domainHint?: string
}

export interface DomainProposal {
  /** 以主題為準的穩定 id，同一個主題不會重複提。 */
  id: string
  topic: string
  domainName: string
  expert: { name: string, role: 'expert', domain: string, soul: string, rules: string }
  notePaths: string[]
}

function topicOf(note: KnowledgeNoteLike): string | undefined {
  const topic = note.domainHint?.trim() || note.tags[0]?.trim()
  return topic || undefined
}

/** 沒有歸入任何（存在的）領域的知識筆記。 */
export function unassignedKnowledgeNotes(notes: readonly KnowledgeNoteLike[], domains: readonly Pick<Domain, 'id'>[]): KnowledgeNoteLike[] {
  const known = new Set(domains.map(domain => domain.id))
  return notes.filter(note => note.type === 'knowledge' && !note.domains.some(id => known.has(id)))
}

export function expertRules(domain: string): string {
  return [
    defaultRules({ role: 'expert' }).trimEnd(),
    '',
    `## 領域：${domain}`,
    `- 只撰寫「${domain}」的知識筆記草稿；草稿交回指揮官統整成提案，不直接寫入筆記庫。`,
    '- 新筆記歸入領域前，先比對類似筆記，找出重複和衝突；只提出觀察，由指揮官提案。',
    '- 只根據筆記庫裡的資料回答，不查外部資料；待查證的可以引用但要標明有爭議，已被取代的預設不引用。',
    // Fork（almanac ALMNC-54.12）：起草時依領域給預設（技術類 6 個月、一般知識 1 年）；lib/cleanup/interval.ts 讀這一行。
    `- 重新確認頻率：${formatInterval(defaultInterval(domain))}（Scott 可以改）。`,
    '',
  ].join('\n')
}

/**
 * 依主題把未歸屬的知識筆記分組；累積到門檻（3 則）以上、而且還沒有同名領域或專家的主題，各產生一則提案。
 * pendingIds：已經在工作台上等決定的領域提案 id，不重複提。
 */
export function domainProposal(
  notes: readonly KnowledgeNoteLike[],
  domains: readonly Domain[],
  roster: readonly RosterAgent[],
  options: { threshold?: number, pendingIds?: readonly string[] } = {},
): DomainProposal[] {
  const threshold = options.threshold ?? DOMAIN_PROPOSAL_THRESHOLD
  const pending = new Set(options.pendingIds ?? [])
  const taken = new Set([
    ...domains.map(domain => normalizeDomainName(domain.name)),
    ...roster.filter(agent => agent.role === 'expert').map(agent => normalizeDomainName(agent.domain)),
  ])
  const groups = new Map<string, { topic: string, notes: KnowledgeNoteLike[] }>()
  for (const note of unassignedKnowledgeNotes(notes, domains)) {
    const topic = topicOf(note)
    if (!topic) continue
    const key = normalizeDomainName(topic)
    const group = groups.get(key) ?? { topic, notes: [] }
    group.notes.push(note)
    groups.set(key, group)
  }
  const usedNames = new Set(roster.map(agent => agent.name.trim().toLowerCase()))
  const proposals: DomainProposal[] = []
  for (const [key, group] of groups) {
    if (group.notes.length < threshold || taken.has(key)) continue
    const id = `domain:${key}`
    if (pending.has(id)) continue
    const name = EXPERT_NAME_POOL.find(candidate => !usedNames.has(candidate.toLowerCase())) ?? `Expert ${usedNames.size + 1}`
    usedNames.add(name.toLowerCase())
    proposals.push({
      id,
      topic: group.topic,
      domainName: group.topic,
      expert: {
        name,
        role: 'expert',
        domain: group.topic,
        soul: defaultSoul({ name, role: 'expert', domain: group.topic }),
        rules: expertRules(group.topic),
      },
      notePaths: Array.from(new Set(group.notes.map(note => note.path))),
    })
  }
  return proposals
}

export interface DomainProposalWriter {
  addDomain: (input: { name: string }) => Promise<Pick<Domain, 'id'>>
  /** 建立專家，回傳固定編號。 */
  createExpert: (input: { name: string, domain: string }) => Promise<string>
  /** 存 soul.md、rules.md（Scott 接受提案＝Scott 本人寫入）。 */
  saveMemory: (agentId: string, input: { name: string, domain: string, soul: string, rules: string }) => Promise<void>
  /** 把筆記的 frontmatter domains 加上新領域。 */
  addNoteDomain: (path: string, domainId: string) => Promise<void>
}

/** Scott 接受領域提案後：建立領域 → 建立專家 → 存 soul／rules → 筆記歸入領域。 */
export async function acceptDomainProposal(proposal: DomainProposal, writer: DomainProposalWriter): Promise<{ domainId: string, agentId: string }> {
  const domain = await writer.addDomain({ name: proposal.domainName })
  const agentId = await writer.createExpert({ name: proposal.expert.name, domain: proposal.expert.domain })
  await writer.saveMemory(agentId, proposal.expert)
  for (const path of proposal.notePaths) await writer.addNoteDomain(path, domain.id)
  return { domainId: domain.id, agentId }
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** 工作台卡片的標題與一句說明（messages 的 commander 命名空間）；畫面在 ALMNC-54.8。 */
export function describeDomainProposal(proposal: DomainProposal, t: Translate): { title: string, summary: string } {
  return {
    title: t('domainProposal.title', { domain: proposal.domainName, name: proposal.expert.name }),
    summary: t('domainProposal.summary', { count: proposal.notePaths.length, topic: proposal.topic }),
  }
}
