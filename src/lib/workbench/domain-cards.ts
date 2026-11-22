// Fork（almanac ALMNC-54.8）：工作台的「知識」卡（成立新領域＋新專家，ALMNC-54.6 domain-proposal 的畫面）
// 與「確認」卡（到期要重新確認的知識筆記）。純函式從筆記庫索引的 frontmatter 算；接受領域提案的寫入在 acceptDomainCard。
import { domainProposal, type DomainProposal, type KnowledgeNoteLike } from '@/lib/commander/domain-proposal'
import type { RosterAgent } from '@/lib/commander/types'
import type { Domain } from '@/lib/v3-model/domain'
import type { ConfirmLike } from './cards'

export interface IndexedNoteLike {
  path: string
  frontmatter: Record<string, unknown> | null
  tags: readonly string[]
}

/** 專家的重新確認頻率預設 1 年（commander/domain-proposal.ts expertRules）。 */
export const RECONFIRM_DAYS = 365

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map(entry => entry.trim())
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function titleOf(note: IndexedNoteLike): string {
  const title = note.frontmatter?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  return (note.path.split('/').pop() ?? note.path).replace(/\.md$/i, '')
}

/** 筆記庫裡已寫入的知識筆記（frontmatter type: knowledge）。 */
export function knowledgeNotesFromIndex(notes: Iterable<IndexedNoteLike>): KnowledgeNoteLike[] {
  const out: KnowledgeNoteLike[] = []
  for (const note of notes) {
    if (note.frontmatter?.type !== 'knowledge') continue
    out.push({
      path: note.path,
      title: titleOf(note),
      type: 'knowledge',
      domains: strings(note.frontmatter.domains),
      tags: [...strings(note.frontmatter.tags), ...note.tags.map(tag => tag.replace(/^#/, ''))],
    })
  }
  return out
}

/** 上次確認超過 RECONFIRM_DAYS 天的知識筆記（舊的在前）。 */
export function confirmNotesFromIndex(notes: Iterable<IndexedNoteLike>, now: number, days = RECONFIRM_DAYS): ConfirmLike[] {
  const out: ConfirmLike[] = []
  for (const note of notes) {
    const last = note.frontmatter?.lastConfirmed
    if (note.frontmatter?.type !== 'knowledge' || typeof last !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(last)) continue
    if (note.frontmatter.status === 'archived' || note.frontmatter.status === 'superseded') continue
    const at = Date.parse(`${last}T00:00:00`)
    if (!Number.isFinite(at) || now - at < days * 86_400_000) continue
    out.push({ path: note.path, title: titleOf(note), lastConfirmed: last })
  }
  return out.sort((a, b) => a.lastConfirmed.localeCompare(b.lastConfirmed))
}

let latest = new Map<string, DomainProposal>()

/** 算領域提案（同主題 3 則以上未歸屬），並記下來給接受時用；dismissed 是 Scott 放棄過的。 */
export function computeDomainProposals(notes: readonly KnowledgeNoteLike[], domains: readonly Domain[], roster: readonly RosterAgent[], dismissed: readonly string[]): DomainProposal[] {
  const proposals = domainProposal(notes, domains, roster).filter(proposal => !dismissed.includes(proposal.id))
  latest = new Map(proposals.map(proposal => [proposal.id, proposal]))
  return proposals
}

export async function acceptDomainCard(id: string): Promise<void> {
  const proposal = latest.get(id)
  if (!proposal) throw new Error(`domain proposal not found: ${id}`)
  const [{ acceptDomainProposal }, { createDefaultDomainWriter }] = await Promise.all([
    import('@/lib/commander/domain-proposal'),
    import('@/lib/commander/default-deps'),
  ])
  await acceptDomainProposal(proposal, await createDefaultDomainWriter())
  latest.delete(id)
}
