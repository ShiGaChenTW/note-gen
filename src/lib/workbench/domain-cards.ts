// Fork（almanac ALMNC-54.8）：工作台的「知識」卡（成立新領域＋新專家，ALMNC-54.6 domain-proposal 的畫面）
// 與「確認」卡（到期要重新確認的知識筆記）。純函式從筆記庫索引的 frontmatter 算；接受領域提案的寫入在 acceptDomainCard。
import { domainProposal, type DomainProposal, type KnowledgeNoteLike } from '@/lib/commander/domain-proposal'
import type { RosterAgent } from '@/lib/commander/types'
import type { Domain } from '@/lib/v3-model/domain'
import { notesDueForConfirm, ymd, type ReconfirmInterval } from '@/lib/cleanup/interval'
import type { ConfirmLike } from './cards'

export interface IndexedNoteLike {
  path: string
  frontmatter: Record<string, unknown> | null
  tags: readonly string[]
}


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

/**
 * 最後確認日期超過領域期限的知識筆記（到期早的在前）。Fork（almanac ALMNC-54.12）：期限改成依領域——
 * 負責專家的 rules.md 寫的（例如「重新確認頻率：6 個月」），沒寫就是技術類 6 個月、一般知識 1 年（lib/cleanup/interval.ts）。
 */
export function confirmNotesFromIndex(notes: Iterable<IndexedNoteLike>, now: number, intervals: ReadonlyMap<string, ReconfirmInterval> = new Map()): ConfirmLike[] {
  return notesDueForConfirm(notes, intervals, ymd(new Date(now)))
    .map(({ path, title, lastConfirmed, dueDate }) => ({ path, title, lastConfirmed, dueDate }))
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
