import type { DomainBlueprint } from './blueprint'
import { defaultInterval, formatInterval } from '@/lib/cleanup/interval'
import { defaultRules, defaultSoul } from '@/lib/agent-memory/templates'
import { domainLookup, type Domain } from '@/lib/v3-model/domain'
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
  expert: { name: string, role: 'expert', domain: string }
  moc: DomainBlueprint
  notePaths: string[]
}

function topicOf(note: KnowledgeNoteLike): string | undefined {
  const topic = note.domainHint?.trim() || note.tags[0]?.trim()
  return topic || undefined
}

/** 沒有歸入任何（存在的）領域的知識筆記。 */
export function unassignedKnowledgeNotes(notes: readonly KnowledgeNoteLike[], domains: readonly Pick<Domain, 'id' | 'name'>[]): KnowledgeNoteLike[] {
  // Fork（almanac ALMNC-69.4）：domains 存領域名稱（舊資料是 dom_ id），兩種都算歸入。
  const known = domainLookup(domains)
  return notes.filter(note => note.type === 'knowledge' && !note.domains.some(ref => known.has(ref.trim())))
}

export function expertRules(domain: string): string {
  return [
    defaultRules({ role: 'expert' }).trimEnd(),
    '',
    `## 領域：${domain}`,
    `- 只撰寫「${domain}」的知識筆記草稿；草稿交回指揮官統整成提案，不直接寫入筆記庫。`,
    '- 新筆記歸入領域前，先比對類似筆記，找出重複和衝突；只提出觀察，由指揮官提案。',
    '- 只根據筆記庫裡的資料回答，不查外部資料；待查證的可以引用但要標明待查證，已被取代的預設不引用。',
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
    const positioning = `如何理解「${group.topic}」？`
    const members = [...new Map(group.notes.map(note => [note.path, note])).values()]
    proposals.push({
      id,
      topic: group.topic,
      domainName: group.topic,
      expert: {
        name,
        role: 'expert',
        domain: group.topic,
      },
      moc: {
        id, name: group.topic, positioning,
        chapters: [{
          id: '1', question: positioning,
          notes: members.map(({ path, title }) => ({ path, title, relation: `提供「${group.topic}」的既有筆記` })),
        }],
      },
      notePaths: members.map(note => note.path),
    })
  }
  return proposals
}

export interface DomainProposalWriter {
  createMoc: (blueprint: DomainBlueprint) => Promise<Pick<Domain, 'id'>>
  /** 建立專家，回傳固定編號。 */
  createExpert: (input: { name: string, domain: string }) => Promise<string>
  /** 存 soul.md、rules.md（Scott 接受提案＝Scott 本人寫入）。 */
  saveMemory: (agentId: string, input: { name: string, domain: string, soul: string, rules: string }) => Promise<void>
}

/** 先成立正式 MOC；勾選配專家時才建立角色及其記憶。 */
export async function acceptDomainProposal(proposal: DomainProposal, writer: DomainProposalWriter, pairExpert = false): Promise<{ domainId: string, agentId?: string }> {
  const { id: domainId } = await writer.createMoc(proposal.moc)
  if (!pairExpert) return { domainId }
  const { name, domain } = proposal.expert
  const agentId = await writer.createExpert({ name, domain })
  await writer.saveMemory(agentId, {
    name, domain, soul: defaultSoul({ name, role: 'expert', domain }), rules: expertRules(domain),
  })
  return { domainId, agentId }
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** 工作台卡片的標題與一句說明（messages 的 commander 命名空間）；畫面在 ALMNC-54.8。 */
export function describeDomainProposal(proposal: DomainProposal, t: Translate): { title: string, summary: string } {
  return {
    title: t('domainProposal.title', { domain: proposal.domainName }),
    summary: t('domainProposal.summary', { count: proposal.notePaths.length, topic: proposal.topic }),
  }
}
