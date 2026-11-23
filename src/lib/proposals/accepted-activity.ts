// Fork（almanac ALMNC-54.21）：接受一則提案後記進共用工作記憶的活動紀錄（定案文件 R5：「接受後由系統寫入，記進活動紀錄」）。
// 一筆紀錄回答三件事：誰提的（角色與固定編號）、改了什麼（對象連結＋一行說明）、來源（對話；沒有對話就是那則提案）。
// 格式檢查在 lib/agent-memory/activity.ts；這裡只把提案換成一筆紀錄。記不進去只記錯，不擋接受（寫入已經完成）。
// 只有 V3 的接受路徑（工作台、對話裡的提案卡）會呼叫；classic 的「等你定」不記。
import type { AgentRole } from '@/lib/agents/settings'
import { ACTIVITY_NOTE_MAX, type ActivityEntryInput } from '@/lib/agent-memory/activity'
import type { Proposal } from '@/lib/collect/types'
import type { DecideItem } from '@/lib/decide/project'
import { newNoteChangesNote, type NewNoteChanges } from '@/lib/workbench/new-note'

export interface AcceptedProposal {
  /** 提案的鍵（collect:… / draft:… / job:… / domain:…）。 */
  key: string
  /** 提案種類：note、task、event，或檔案變更的 create、update、delete、move…。 */
  kind: string
  /** 一行說明（標題或摘要）。 */
  what: string
  /** 撰寫者；沒記的當成指揮官（提案都由指揮官送進工作台，定案文件 R5）。 */
  drafter?: Proposal['drafter']
  conversationId?: number
  /** 接受後寫到的檔案；沒有就連回提案本身。 */
  path?: string
}

const SCHEDULE_KINDS = new Set(['task', 'event'])

function clip(text: string): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, ACTIVITY_NOTE_MAX).join('')
}

/** 對象連結：任務、時段寫進日誌（task:）、筆記（note:）；不知道寫到哪就連回提案（proposal:）。 */
export function acceptedTargetLink(proposal: Pick<AcceptedProposal, 'key' | 'kind' | 'path'>): string {
  if (proposal.path) return `${SCHEDULE_KINDS.has(proposal.kind) ? 'task' : 'note'}:${encodeURI(proposal.path)}`
  return `proposal:${encodeURIComponent(proposal.key)}`
}

export function acceptedActivityEntry(proposal: AcceptedProposal, roster: ReadonlyArray<{ id: string, role: AgentRole }>): ActivityEntryInput {
  const role = proposal.drafter?.role ?? 'commander'
  const actorId = proposal.drafter?.agentId || roster.find(agent => agent.role === role)?.id || role
  return {
    actorId,
    actorRole: role,
    action: 'accepted',
    targetLink: acceptedTargetLink(proposal),
    source: proposal.conversationId !== undefined
      ? { kind: 'conversation', ref: String(proposal.conversationId) }
      : { kind: 'proposal', ref: proposal.key },
    note: clip(proposal.what),
  }
}

/** 工作台上的提案（DecideItem）→ 一筆紀錄的輸入；path 是接受後寫到的檔案。 */
// Fork（almanac ALMNC-69.2）：Scott 改過新增筆記的標題或位置時，說明改寫成「原建議 → 你的修改」（lib/workbench/new-note.ts）。
export function acceptedFromDecide(item: Pick<DecideItem, 'key' | 'kind' | 'title' | 'summary' | 'drafter' | 'conversationId'>, path?: string, changes?: NewNoteChanges | null): AcceptedProposal {
  return {
    key: item.key,
    kind: item.kind,
    what: changes ? newNoteChangesNote(changes) : item.summary || item.title,
    ...(item.drafter ? { drafter: item.drafter } : {}),
    ...(item.conversationId !== undefined ? { conversationId: item.conversationId } : {}),
    ...(path ? { path } : {}),
  }
}

/** 對話裡提案卡接受的收集提案 → 一筆紀錄的輸入。 */
export function acceptedFromProposal(key: string, proposal: Pick<Proposal, 'kind' | 'title' | 'change' | 'drafter' | 'conversationId'>, path?: string, changes?: NewNoteChanges | null): AcceptedProposal {
  return {
    key,
    kind: proposal.change?.kind ?? proposal.kind,
    what: changes ? newNoteChangesNote(changes) : proposal.change?.summary || proposal.title,
    ...(proposal.drafter ? { drafter: proposal.drafter } : {}),
    ...(proposal.conversationId !== undefined ? { conversationId: proposal.conversationId } : {}),
    ...(path ? { path } : {}),
  }
}

/** 寫一筆（App 內；需要 Tauri 資料庫）。失敗只記錯。 */
export async function logAcceptedProposal(proposal: AcceptedProposal): Promise<void> {
  try {
    const [{ appendActivity }, { listAgentSettings }] = await Promise.all([import('@/db/agent-memory'), import('@/db/agents')])
    const roster = await listAgentSettings().catch(() => [])
    await appendActivity('system', acceptedActivityEntry(proposal, roster))
  } catch (error) {
    console.error('[proposals] accepted activity not logged:', error)
  }
}
