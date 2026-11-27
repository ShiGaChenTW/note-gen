// Fork（almanac ALMNC-90）：紀錄筆記（日誌筆記：會議紀錄、日誌）的「送給指揮官萃取」——純邏輯（依賴注入）。
// 把這篇筆記送成一則自己寫的資料源（形式 record_extract），沿用指揮官分析流程（ALMNC-54.6）：
// 指揮官只從裡面萃取一年後仍成立的知識筆記，以「新增知識筆記」提案進工作台，提案帶著這則資料源，並連回這篇紀錄筆記。
// 去重：id 由筆記路徑決定（和一般「送給指揮官」的 src_note: 分開）；
// 已有未處理的萃取提案 → 不送、提示先處理；還在萃取中 → 不送；內容沒變 → 不送；內容改了 → 照資料源版本規則接新版。
// 接到 App 的部分在 actions.ts 的 sendRecordForExtraction。
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { parseV3Note } from '@/lib/v3-model/note'
import { RECORD_EXTRACT_KIND, sourceKeys, type Source } from '@/lib/v3-model/source'
import type { Proposal } from '@/lib/collect/types'
import { routeAutoSource, type AutoRouteDeps, type AutoSourceInput, type VersionedRouteDeps } from './auto-route'

/** frontmatter 原文（含前後 ---）是不是紀錄類筆記：type 是 log（或舊值 record）。frontmatter 壞掉就不是。 */
export function isRecordNote(raw: string | null | undefined): boolean {
  if (!raw) return false
  try {
    return parseV3Note(raw).fields.type === 'record'
  } catch {
    return false
  }
}

/** 萃取資料源的 id：由筆記路徑決定，同一篇再送找得到同一條版本鏈。 */
export function recordExtractSourceId(path: string): string {
  return `src_extract:${path}`
}

/** 萃取出來的知識筆記連回紀錄筆記用的 wiki 連結（Obsidian 用檔名找筆記）。 */
export function recordNoteLink(path: string): string {
  const name = (path.split('/').pop() ?? path).replace(/\.md$/i, '')
  return `[[${name}]]`
}

/**
 * 去掉 frontmatter 的身分編號（id）那一行：系統在開啟筆記時會補上編號（ALMNC-69.1），
 * 不算 Scott 改了內容，也不必送給指揮官。其他字一個都不動。
 */
export function withoutIdentityLine(content: string): string {
  const { block, body } = splitFrontmatter(content)
  if (!block) return content
  const kept = block.split(/(?<=\n)/).filter(line => !/^id[ \t]*:/.test(line))
  return kept.join('') + body
}

export function recordExtractSource(note: { path: string, content: string }): AutoSourceInput | undefined {
  const content = withoutIdentityLine(note.content).trim()
  if (!content || !note.path) return undefined
  return { id: recordExtractSourceId(note.path), sourceType: 'self', kind: RECORD_EXTRACT_KIND, content, origin: note.path, collector: 'scott' }
}

/** 工作台（收集項目）裡有沒有還在等 Scott 決定、來源是這些資料源的提案。 */
export function hasPendingProposalsFor(
  items: ReadonlyArray<{ proposals: ReadonlyArray<Pick<Proposal, 'sourceIds'> & { status: string }> }>,
  sourceIds: readonly string[],
): boolean {
  if (!sourceIds.length) return false
  const ids = new Set(sourceIds)
  return items.some(item => item.proposals.some(proposal => proposal.status === 'wait' && (proposal.sourceIds ?? []).some(id => ids.has(id))))
}

export interface RecordExtractDeps extends AutoRouteDeps, Pick<VersionedRouteDeps, 'edit'> {
  /** 從第一版的 id 列出整條版本鏈（舊到新）；還沒登錄過回空陣列。 */
  chain: (rootId: string) => Promise<Source[]>
  /** 工作台有沒有來源是這些資料源、還沒處理的提案。 */
  hasPendingProposals: (sourceIds: string[]) => Promise<boolean>
}

/**
 * added：第一次送；versioned：內容改了、接了新版；unchanged：內容沒變；pending：已有未處理的萃取提案；
 * inProgress：指揮官還在萃取上一次送的；empty：沒有內容。只有 added／versioned 會叫指揮官。
 */
export type RecordExtractOutcome = 'added' | 'versioned' | 'unchanged' | 'pending' | 'inProgress' | 'empty'

export interface RecordExtractResult {
  outcome: RecordExtractOutcome
  source?: Source
  queued: boolean
}

export async function routeRecordExtract(note: { path: string, content: string }, deps: RecordExtractDeps): Promise<RecordExtractResult> {
  const input = recordExtractSource(note)
  if (!input) return { outcome: 'empty', queued: false }
  const chain = await deps.chain(input.id)
  const latest = chain[chain.length - 1]
  if (!latest) {
    const result = await routeAutoSource(input, deps)
    // 同時有人先登錄了同一個 id（addIfAbsent 跳過）就當成沒變。
    return { ...result, outcome: result.source ? 'added' : 'unchanged' }
  }
  if (await deps.hasPendingProposals(chain.flatMap(sourceKeys))) return { outcome: 'pending', queued: false }
  if (latest.status === 'pending_analysis' || latest.status === 'analyzing') return { outcome: 'inProgress', queued: false }
  if (withoutIdentityLine(latest.content).trim() === input.content) return { outcome: 'unchanged', queued: false }
  const edited = await deps.edit(latest.id, input.content)
  if (edited.source.status !== 'pending_analysis') return { outcome: 'versioned', source: edited.source, queued: false }
  await deps.kick()
  return { outcome: 'versioned', source: edited.source, queued: true }
}
