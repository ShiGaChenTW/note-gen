// Fork（#30）：審核草稿。收下時用原本的工具真正寫入 vault；寫入前先比對衝突。
import type { AgentTool, AgentToolResult } from '@/lib/agent/types'
import { dependsOnPendingDraft, hasConflict, requiresIndividualReview } from './draft'
import type { DraftChange } from './types'

export interface ReviewDeps {
  readFile: (path: string) => Promise<string | null>
  getTool: (name: string) => AgentTool | undefined
}

export interface DraftReviewView {
  draft: DraftChange
  conflict: boolean
  individual: boolean
  currentContent: string | null
}

/** 打開審核畫面時呼叫：每筆草稿目前有沒有衝突、能不能整批收下。 */
export async function inspectDrafts(drafts: DraftChange[], deps: Pick<ReviewDeps, 'readFile'>): Promise<DraftReviewView[]> {
  return Promise.all(drafts.map(async draft => {
    const currentContent = draft.kind === 'folder' ? null : await deps.readFile(draft.path)
    const conflict = draft.state === 'pending' && hasConflict(draft, currentContent, drafts)
    const individual = requiresIndividualReview(draft, conflict) || dependsOnPendingDraft(draft, drafts)
    return { draft, conflict, individual, currentContent }
  }))
}

/**
 * 收下一筆草稿。confirmedConflict 為 true 表示使用者看過差異、仍要覆蓋。
 * 回傳更新後的草稿（state 變成 applied 或 failed）。
 */
export async function applyDraft(draft: DraftChange, deps: ReviewDeps, confirmedConflict = false, siblings: DraftChange[] = []): Promise<DraftChange> {
  if (draft.state !== 'pending') return draft
  const currentContent = draft.kind === 'folder' ? null : await deps.readFile(draft.path)
  if (hasConflict(draft, currentContent, siblings) && !confirmedConflict) {
    return { ...draft, state: 'failed', error: 'CONFLICT' }
  }
  const tool = deps.getTool(draft.toolName)
  if (!tool) return { ...draft, state: 'failed', error: `找不到工具 ${draft.toolName}` }
  const args = { ...draft.args }
  // 衝突已由這裡判斷過，不再讓工具用舊的修改時間擋下。
  delete args.expectedModifiedAt
  let result: AgentToolResult
  try {
    result = await tool.execute(args, { runId: `review-${draft.id}`, context: { userInput: '' } })
  } catch (error) {
    return { ...draft, state: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
  return result.ok
    ? { ...draft, state: 'applied', error: undefined }
    : { ...draft, state: 'failed', error: result.error || result.message }
}

/** 整批收下：只處理不需逐條確認的草稿，依建立順序寫入。 */
export async function applyBulk(views: DraftReviewView[], deps: ReviewDeps): Promise<DraftChange[]> {
  const results: DraftChange[] = []
  for (const view of views) {
    if (view.draft.state !== 'pending' || view.individual) {
      results.push(view.draft)
      continue
    }
    results.push(await applyDraft(view.draft, deps, false, results))
  }
  return results
}

export function discardDraft(draft: DraftChange): DraftChange {
  return draft.state === 'pending' ? { ...draft, state: 'discarded' } : draft
}
