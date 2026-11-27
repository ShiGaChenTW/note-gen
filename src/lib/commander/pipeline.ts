// Fork（almanac ALMNC-54.6）：指揮官分析流程（C0）的入口與佇列。
// 流程：待分析 → 分析中 → 轉文字 → 拆開與判斷 → 分派 → C1～C3 撰寫 → 統整成提案送工作台 → 已分析（全部不採用則不採用）。
// 只分析「待分析」的資料源：外部擷取的（A5）要等 Scott 在工作台選「處理」才會變成待分析（路由 R1），
// 自己寫的、系統產生的一進來就是待分析（R2）。所以 A5 進來時不會被轉文字。
// 分析中途出錯就退回待分析，等下一輪重試；提案批次 id 以資料源為準，重跑不會重複送。
import { finalStatusAfterAnalysis, isLegacyNote, isRecordExtract, type Source } from '@/lib/v3-model/source'
import { recordNoteLink } from '@/lib/workbench/record-extract'
import { assign } from './assign'
import { consolidate } from './consolidate'
import { draft } from './draft'
import { fallbackFragment, splitSource, type SplitResult } from './split'
import { toText } from './to-text'
import type { AnalyzeOptions, AnalyzeResult, CommanderDeps, Fragment } from './types'

function sourceLabel(source: Source): string {
  const first = source.content.trim().split('\n')[0] ?? ''
  const label = /^data:/i.test(first) ? '' : first
  return Array.from(label || source.origin || source.kind).slice(0, 48).join('')
}

async function hintOf(source: Source, deps: CommanderDeps): Promise<string | undefined> {
  try {
    return await deps.sourceHint?.(source.id)
  } catch {
    return undefined
  }
}

async function previousText(source: Source, deps: CommanderDeps): Promise<string | undefined> {
  if (!source.previousId) return undefined
  try {
    return (await deps.sources.get(source.previousId))?.content
  } catch {
    return undefined
  }
}

/** 分析一則資料源。不是待分析（例如外部擷取還在等 Scott 決定）就跳過，不做任何轉換。 */
export async function analyzeSource(sourceId: string, deps: CommanderDeps, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const found = await deps.sources.get(sourceId)
  if (!found) return { status: 'skipped', sourceId, reason: 'not_found' }
  if (found.status !== 'pending_analysis' || found.archivedAt !== undefined) return { status: 'skipped', sourceId, reason: 'not_pending' }

  const source = await deps.sources.setStatus(sourceId, 'analyzing')
  try {
    const now = deps.now?.() ?? new Date()
    const extracting = isRecordExtract(source)
    const conversion = await toText(source, deps.converters)
    const unconverted = (reason?: string) =>
      [fallbackFragment(deps.labels.unconverted({ origin: source.origin ?? source.kind, reason }), source.origin)]
    // Fork（almanac ALMNC-54.19）：轉換器回報了明確原因（掃描 PDF、加密檔、不支援的格式…）就直接寫成說明提案，
    // 不把原檔路徑當內容送給模型；資料源照樣標成已分析，佇列繼續下一則。
    // Fork（almanac ALMNC-69.3）：帶日誌標籤的資料源不拆日誌筆記、只找知識；沒標籤時指揮官另外判斷整則是不是日誌（只能提議）。
    const split: SplitResult = conversion.reason
      ? { fragments: unconverted(conversion.reason) }
      : conversion.text.trim()
      ? await splitSource(conversion.text, deps.ask, {
          today: now,
          sourceKind: source.kind,
          origin: source.origin,
          previousText: await previousText(source, deps),
          hint: await hintOf(source, deps),
          journalTagged: source.journal,
          // Fork（almanac ALMNC-90）：紀錄筆記送來萃取：只萃取知識筆記。
          ...(extracting ? { extractKnowledge: true } : {}),
        })
      : { fragments: unconverted() }
    const fragments: Fragment[] = split.fragments

    const [roster, domains] = await Promise.all([deps.roster(), deps.domains()])
    const assignments = assign(fragments, roster, domains)
    const drafts = await draft(assignments, { ask: deps.ask, roster, agentPrompt: deps.agentPrompt, findSimilarNotes: deps.findSimilarNotes })
    const rejected = assignments.filter(item => item.lane === 'reject').map(item => item.fragment)

    const commander = roster.find(agent => agent.role === 'commander' && agent.enabled)
    const batch = consolidate({
      source,
      drafts,
      origin: deps.labels.origin({ agent: commander?.name ?? '', source: sourceLabel(source) }),
      conversationId: options.conversationId,
      ...(split.journal ? { journal: split.journal, sourceLabel: sourceLabel(source) } : {}),
      // Fork（almanac ALMNC-90）：萃取出的知識筆記連回那篇紀錄筆記。
      ...(extracting && source.origin ? { related: [recordNoteLink(source.origin)] } : {}),
    })
    if (batch) await deps.submitProposals(batch)

    // 日誌讀過沒有可提煉的內容就停在已分析，不會被不採用。
    const status = finalStatusAfterAnalysis(source, !!batch)
    await deps.sources.setStatus(sourceId, status)
    await deps.logActivity?.({
      sourceId,
      batchId: batch?.id,
      status,
      note: `${batch?.proposals.length ?? 0} proposals, ${rejected.length} rejected (${conversion.converter}/${conversion.status})${conversion.reason ? ` ${conversion.reason}` : ''}`,
    }).catch(error => console.warn('[commander] activity log failed:', error))
    const rememberWork = deps.rememberWork
    if (rememberWork) {
      const reference = `source:${sourceId}`
      const fromScott = source.sourceType === 'self' && conversion.status === 'text'
      const updates = roster.flatMap(agent => {
        if (!agent.enabled) return []
        const authored = drafts.filter(item => item.agentId === agent.id && item.meta.writtenBy === 'ai')
        if (!authored.length && agent !== commander) return []
        return [rememberWork(agent, {
          reference,
          conversationId: options.conversationId,
          ...(fromScott ? { request: conversion.text, fromScott } : {}),
          result: JSON.stringify({ status, drafts: authored.map(({ kind, title }) => ({ kind, title })) }),
        }).catch(error => console.warn('[commander] memory update failed:', error))]
      })
      await Promise.all(updates)
    }
    return { status, sourceId, conversion, fragments, assignments, drafts, rejected, batch }
  } catch (error) {
    await deps.sources.setStatus(sourceId, 'pending_analysis').catch(() => undefined)
    throw error
  }
}

export interface QueueSummary {
  analyzed: string[]
  rejected: string[]
  failed: Array<{ sourceId: string, error: string }>
}

/** 上次執行被中斷（App 關掉）而卡在分析中的資料源退回待分析。只在佇列第一次啟動時呼叫。 */
export async function requeueInterrupted(deps: Pick<CommanderDeps, 'sources'>): Promise<string[]> {
  // Fork（almanac ALMNC-54.14）：舊筆記由舊筆記批次自己退回（它可能正在分析），一般佇列不碰。
  const stuck = (await deps.sources.list({ status: 'analyzing' })).filter(source => !isLegacyNote(source))
  const ids: string[] = []
  for (const source of stuck) {
    await deps.sources.setStatus(source.id, 'pending_analysis')
    ids.push(source.id)
  }
  return ids
}

/** 依收集時間由舊到新，一則一則分析待分析的資料源；某一則失敗不影響其他的。 */
export async function runAnalysisQueue(deps: CommanderDeps, options: { limit?: number } = {}): Promise<QueueSummary> {
  // Fork（almanac ALMNC-54.14）：舊筆記只由舊筆記批次處理（R3：按一次才分批），一般佇列跳過。
  const pending = (await deps.sources.list({ status: 'pending_analysis', limit: 500 }))
    .filter(source => !isLegacyNote(source))
    .sort((a, b) => a.collectedAt - b.collectedAt)
    .slice(0, options.limit ?? 5)
  const summary: QueueSummary = { analyzed: [], rejected: [], failed: [] }
  for (const source of pending) {
    try {
      const result = await analyzeSource(source.id, deps)
      if (result.status === 'analyzed') summary.analyzed.push(source.id)
      else if (result.status === 'rejected') summary.rejected.push(source.id)
    } catch (error) {
      summary.failed.push({ sourceId: source.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return summary
}

/**
 * 佇列：同一時間只跑一輪；跑的時候又被叫就在跑完後再補一輪。
 * 第一次 run 先把中斷的分析退回待分析。54.10（R1 選「處理」）與 R2（自己寫的、系統產生的資料源新增後）呼叫 kick()。
 */
export function createAnalysisQueue(deps: CommanderDeps, options: { limit?: number } = {}) {
  let running: Promise<QueueSummary> | undefined
  let again = false
  let recovered = false
  const loop = async (): Promise<QueueSummary> => {
    if (!recovered) {
      recovered = true
      await requeueInterrupted(deps)
    }
    const total: QueueSummary = { analyzed: [], rejected: [], failed: [] }
    do {
      again = false
      const round = await runAnalysisQueue(deps, options)
      total.analyzed.push(...round.analyzed)
      total.rejected.push(...round.rejected)
      total.failed.push(...round.failed)
    } while (again)
    return total
  }
  return {
    kick(): Promise<QueueSummary> {
      if (running) {
        again = true
        return running
      }
      running = loop().finally(() => {
        running = undefined
      })
      return running
    },
    get running() {
      return running !== undefined
    },
  }
}
