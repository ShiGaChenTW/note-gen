// Fork（almanac ALMNC-54.6）：分析第六步——C1～C3 的草稿交回指揮官，統整成提案送到工作台。
// 提案沿用收集項目的模型（src/lib/collect/types.ts Proposal），工作台由 lib/decide/project.ts 投影出來；
// 這裡完全不碰筆記庫。source_outputs 連結要等 Scott 接受、真的寫入後才建立（acceptedOutputLinks）。
import { newProposalId } from '@/lib/collect/split'
import type { Proposal } from '@/lib/collect/types'
import type { Source } from '@/lib/v3-model/source'
import type { OutputTargetType } from '@/lib/v3-model/links'
import type { Draft, ProposalBatch } from './types'

const TAG_RE = /^[\p{L}\p{N}_/-]+$/u

/** 專案名稱轉成可以當標籤的字（空白換成 -），轉不成就不加。 */
export function projectTag(project: string | undefined): string | undefined {
  const tag = project?.trim().replace(/\s+/g, '-')
  return tag && TAG_RE.test(tag) ? tag : undefined
}

export function draftToProposal(draft: Draft, sourceIds: readonly string[], conversationId?: number): Proposal {
  const tags = Array.from(new Set([...draft.tags, ...(draft.kind !== 'note' ? [projectTag(draft.project)].filter((tag): tag is string => !!tag) : [])]))
  return {
    id: newProposalId(),
    kind: draft.kind,
    title: draft.title,
    body: draft.kind === 'note' ? draft.body : '',
    due: draft.date ?? '',
    time: draft.kind === 'event' ? draft.time ?? '' : '',
    tags,
    sourceIds: [...sourceIds],
    ...(draft.kind === 'note' && draft.noteType ? { noteType: draft.noteType } : {}),
    ...(draft.kind === 'note' && draft.domainIds.length ? { domains: [...draft.domainIds] } : {}),
    ...(draft.people.length ? { people: [...draft.people] } : {}),
    ...(draft.project ? { project: draft.project } : {}),
    drafter: { role: draft.role, ...(draft.agentId ? { agentId: draft.agentId } : {}) },
    ...(conversationId !== undefined ? { conversationId } : {}),
  }
}

export interface ConsolidateInput {
  source: Pick<Source, 'id' | 'content' | 'origin'>
  drafts: readonly Draft[]
  /** 工作台上「來自…」的名稱，例如「Mia · 指揮官 分析的資料源：…」。 */
  origin: string
  conversationId?: number
}

/** 同一則資料源、同一件事（種類＋標題＋日期）只提一次。 */
function dedupe(drafts: readonly Draft[]): Draft[] {
  const seen = new Set<string>()
  return drafts.filter(draft => {
    const key = [draft.kind, draft.title.trim().toLowerCase(), draft.date ?? '', draft.time ?? ''].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 草稿 → 一批提案；沒有草稿（全部不採用）時回傳 undefined。批次 id 以資料源為準，重跑不會重複送。 */
export function consolidate(input: ConsolidateInput): ProposalBatch | undefined {
  const drafts = dedupe(input.drafts)
  if (!drafts.length) return undefined
  return {
    id: `commander:${input.source.id}`,
    origin: input.origin,
    proposals: drafts.map(draft => draftToProposal(draft, [input.source.id], input.conversationId)),
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
  }
}

export interface OutputLink {
  sourceId: string
  targetType: OutputTargetType
  targetRef: string
}

/**
 * Scott 接受、系統寫入之後才呼叫：這則提案該在 source_outputs 留下哪些連結。
 * 筆記指向寫入的 vault 路徑；行動目前寫在每日筆記的任務行，還沒有自己的 id，先用「檔案路徑#提案 id」。
 */
export function acceptedOutputLinks(proposal: Pick<Proposal, 'id' | 'kind' | 'sourceIds'>, result: { path: string }): OutputLink[] {
  if (!proposal.sourceIds?.length || !result.path) return []
  const targetType: OutputTargetType = proposal.kind === 'note' ? 'note' : 'action'
  const targetRef = targetType === 'note' ? result.path : `${result.path}#${proposal.id}`
  return Array.from(new Set(proposal.sourceIds)).map(sourceId => ({ sourceId, targetType, targetRef }))
}

/** 接受後寫連結；writer 預設是 src/db/v3-sources.ts 的 addSourceOutput。 */
export async function linkAcceptedOutputs(
  proposal: Pick<Proposal, 'id' | 'kind' | 'sourceIds'>,
  result: { path: string },
  writer?: (link: OutputLink) => Promise<void>,
): Promise<OutputLink[]> {
  const links = acceptedOutputLinks(proposal, result)
  if (!links.length) return links
  const write = writer ?? (async (link: OutputLink) => {
    const { addSourceOutput } = await import('@/db/v3-sources')
    await addSourceOutput(link.sourceId, link.targetType, link.targetRef)
  })
  for (const link of links) await write(link)
  return links
}
