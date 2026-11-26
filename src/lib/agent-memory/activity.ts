// Fork（almanac ALMNC-54.3）：活動紀錄的固定格式與檢查。
// 活動紀錄只記「誰在什麼時候做了什麼」：時間、角色、動作、對象連結、來源（對話或提案），自由文字最多 60 字。
// 沒有對象連結就拒絕寫入。記錯不能改也不能刪，只能新增一筆更正（corrected），指回原本那一筆。
import { isAgentRole, type AgentRole } from '@/lib/agents/settings'

export const ACTIVITY_ACTIONS = [
  'instructed', // Scott 交代的事
  'drafted',
  'proposed',
  'accepted',
  'auto_accepted',
  'rejected',
  'created',
  'updated',
  'linked',
  'reported', // 例如非指揮官發現目前脈絡有誤時回報
  'corrected', // 更正先前的紀錄，一定要有 correctsId
  'undone', // Fork（almanac ALMNC-69.9）：復原了一筆操作（opId 指向被復原的操作）；原本那筆紀錄不改
  'deleted', // Fork（almanac ALMNC-84.7）：外部 MCP 顧問刪除項目（已進最近刪除，30 天內可救回）
  'repaired', // Fork（almanac ALMNC-71）：系統修復（掃描補號、修連結、時鐘提醒），只能由 system 角色寫
] as const
export type ActivityAction = typeof ACTIVITY_ACTIONS[number]

/** Fork（almanac ALMNC-71／84.7）：system＝系統自動修復；mcp＝外部 MCP 顧問工具呼叫（ref 是工具名稱）。 */
export const ACTIVITY_SOURCE_KINDS = ['conversation', 'proposal', 'system', 'mcp'] as const
export type ActivitySourceKind = typeof ACTIVITY_SOURCE_KINDS[number]

export const ACTIVITY_NOTE_MAX = 60
export const ACTIVITY_ARCHIVE_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

/** Fork（almanac ALMNC-71／84.7）：'system' 是系統自動修復；'advisor' 是外部 MCP 顧問（非夥伴名單）。 */
export type ActivityActorRole = AgentRole | 'scott' | 'system' | 'advisor'

export const SYSTEM_ACTOR_ID = 'system'
export const ADVISOR_ACTOR_PREFIX = 'mcp:'

export function formatAdvisorActorId(clientName?: string): string {
  const cleaned = clientName?.trim()
  return `${ADVISOR_ACTOR_PREFIX}${cleaned || 'External MCP'}`
}

export function advisorClientName(actorId: string): string {
  return actorId.startsWith(ADVISOR_ACTOR_PREFIX)
    ? actorId.slice(ADVISOR_ACTOR_PREFIX.length) || 'External MCP'
    : actorId
}

export interface ActivityEntryInput {
  /** agent 的固定編號；Scott 交代的事寫 'scott'；系統修復寫 'system'。 */
  actorId: string
  actorRole: ActivityActorRole
  action: ActivityAction
  /** 對象連結：[[筆記標題]]，或 note:／task:／source:／project:／proposal:／https: 這類連結。 */
  targetLink: string
  source: { kind: ActivitySourceKind, ref: string }
  /** 自由文字，最多 60 字。 */
  note?: string
  /** 更正哪一筆紀錄。 */
  correctsId?: number
  /** Fork（almanac ALMNC-69.9）：對應的操作（ops 表）；有就能在 7 天內復原。 */
  opId?: string
}

export interface ActivityEntry extends Omit<ActivityEntryInput, 'note' | 'correctsId' | 'opId'> {
  id: number
  at: number
  note: string
  correctsId: number | null
  archivedAt: number | null
  /** 舊紀錄沒有。 */
  opId?: string | null
}

export type ActivityValidationError =
  | 'ACTOR_REQUIRED'
  | 'ACTOR_ROLE_INVALID'
  | 'ACTION_INVALID'
  | 'TARGET_LINK_REQUIRED'
  | 'TARGET_LINK_INVALID'
  | 'SOURCE_REQUIRED'
  | 'NOTE_TOO_LONG'
  | 'CORRECTION_TARGET_REQUIRED'
  | 'CORRECTION_ACTION_REQUIRED'
  | 'UNKNOWN_FIELD'
  | 'SYSTEM_ENTRY_INVALID'

export interface NormalizedActivityEntry {
  actorId: string
  actorRole: ActivityActorRole
  action: ActivityAction
  targetLink: string
  sourceKind: ActivitySourceKind
  sourceRef: string
  note: string
  correctsId: number | null
  opId: string | null
}

const ALLOWED_FIELDS = new Set(['actorId', 'actorRole', 'action', 'targetLink', 'source', 'note', 'correctsId', 'opId'])
const WIKI_LINK = /^\[\[[^[\]\n]+\]\]$/
const URI_LINK = /^[a-z][a-z0-9+.-]*:\S+$/i

/** 用字元數（不是 UTF-16 長度）計算，中文、emoji 都算一個字。 */
export function charCount(text: string): number {
  return [...text].length
}

export function isTargetLink(value: string): boolean {
  const link = value.trim()
  return WIKI_LINK.test(link) || URI_LINK.test(link)
}

export function isActivityAction(value: unknown): value is ActivityAction {
  return ACTIVITY_ACTIONS.some(action => action === value)
}

/** 檢查並整理一筆活動紀錄；時間由系統在寫入時填，不接受外部指定。 */
export function validateActivityEntry(input: ActivityEntryInput):
  { ok: true, entry: NormalizedActivityEntry } | { ok: false, error: ActivityValidationError } {
  const fail = (error: ActivityValidationError) => ({ ok: false, error }) as const
  if (Object.keys(input).some(key => !ALLOWED_FIELDS.has(key))) return fail('UNKNOWN_FIELD')
  const actorId = typeof input.actorId === 'string' ? input.actorId.trim() : ''
  if (!actorId) return fail('ACTOR_REQUIRED')
  const reserved = actorId === 'scott' || actorId === SYSTEM_ACTOR_ID
  if (input.actorRole === 'scott' ? actorId !== 'scott'
    : input.actorRole === 'system' ? actorId !== SYSTEM_ACTOR_ID
      : input.actorRole === 'advisor' ? reserved
        : !isAgentRole(input.actorRole) || reserved) {
    return fail('ACTOR_ROLE_INVALID')
  }
  if (!isActivityAction(input.action)) return fail('ACTION_INVALID')
  // 系統修復三者一起出現：system 角色只寫 repaired、來源 system；repaired 和來源 system 也只給 system 角色。
  const system = input.actorRole === 'system'
  if (system !== (input.action === 'repaired') || system !== (input.source?.kind === 'system')) return fail('SYSTEM_ENTRY_INVALID')
  // 外部 MCP 顧問與來源 mcp 成對出現，不與 Crew 夥伴混淆。
  if ((input.actorRole === 'advisor') !== (input.source?.kind === 'mcp')) return fail('ACTOR_ROLE_INVALID')
  const targetLink = typeof input.targetLink === 'string' ? input.targetLink.trim() : ''
  if (!targetLink) return fail('TARGET_LINK_REQUIRED')
  if (!isTargetLink(targetLink)) return fail('TARGET_LINK_INVALID')
  const sourceRef = typeof input.source?.ref === 'string' ? input.source.ref.trim() : ''
  if (!ACTIVITY_SOURCE_KINDS.includes(input.source?.kind) || !sourceRef) return fail('SOURCE_REQUIRED')
  const note = (input.note ?? '').trim()
  if (charCount(note) > ACTIVITY_NOTE_MAX) return fail('NOTE_TOO_LONG')
  const correctsId = input.correctsId ?? null
  if (input.action === 'corrected' && (correctsId === null || !Number.isInteger(correctsId) || correctsId <= 0)) {
    return fail('CORRECTION_TARGET_REQUIRED')
  }
  if (input.action !== 'corrected' && correctsId !== null) return fail('CORRECTION_ACTION_REQUIRED')
  const opId = typeof input.opId === 'string' && input.opId.trim() ? input.opId.trim() : null
  return {
    ok: true,
    entry: { actorId, actorRole: input.actorRole, action: input.action, targetLink, sourceKind: input.source.kind, sourceRef, note, correctsId, opId },
  }
}

/** 封存的時間點：早於這個時間的紀錄要封存。 */
export function archiveCutoff(now: number): number {
  return now - ACTIVITY_ARCHIVE_DAYS * DAY_MS
}

/** 挑出超過 90 天、還沒封存的紀錄；只標記封存，不刪除。 */
export function selectActivityToArchive(
  rows: readonly Pick<ActivityEntry, 'id' | 'at' | 'archivedAt'>[],
  now: number,
): number[] {
  const cutoff = archiveCutoff(now)
  return rows.filter(row => row.archivedAt === null && row.at < cutoff).map(row => row.id)
}
