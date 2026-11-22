// Fork（almanac ALMNC-10）：收集項目與提案的保存。
// 保存的是「收集」這個來源自己的狀態（還沒收下的提案關頁、重開後還在），等你定只讀它、不複製。
// 放在 store.json 的 collectItems：資料小、和其他 fork 設定（新介面開關、首頁卡片）同一處、Tauri 已有權限，
// 不需要另開資料表或新增檔案位置。
import { toDateKey } from '@/lib/daily/format'
import { isSlotTarget } from '@/lib/timeslots/model'
import { NOTE_TYPES } from '@/lib/v3-model/note'
import type { CollectInput, FileChange, Proposal, SplitSource } from './types'

export const COLLECT_ITEMS_KEY = 'collectItems'
/** 全部處理完的項目保留多久（毫秒）；沒處理完的一直留著。 */
export const DECIDED_KEEP_MS = 3 * 86_400_000

type Status = 'wait' | 'ok' | 'no'

export interface PersistedProposal extends Proposal {
  status: Status
  /** 只留寫入的檔案路徑；復原資料（整份日誌前後內容）重開後不留，所以重開後不能再復原。 */
  result?: { path: string }
}

export interface PersistedItem {
  id: string
  input: CollectInput
  createdAt: number
  state: 'ready'
  source?: SplitSource
  proposals: PersistedProposal[]
  recordId?: number
}

interface ItemLike {
  id: string
  input: CollectInput
  createdAt: number
  state: 'reading' | 'ready'
  source?: SplitSource
  proposals: Array<Proposal & { status: Status, result?: { path: string } }>
  recordId?: number
}

/** 存檔前：只存拆完的項目，圖片資料網址（可能很大）不存。 */
export function serializeItems(items: readonly ItemLike[]): PersistedItem[] {
  return items.filter(item => item.state === 'ready').map(item => ({
    id: item.id,
    input: { kind: item.input.kind, text: item.input.text, name: item.input.name },
    createdAt: item.createdAt,
    state: 'ready',
    source: item.source,
    recordId: item.recordId,
    proposals: item.proposals.map(proposal => ({
      id: proposal.id, kind: proposal.kind, title: proposal.title, body: proposal.body,
      due: proposal.due, time: proposal.time, tags: [...proposal.tags],
      ...(proposal.slot ? { slot: proposal.slot } : {}),
      ...(proposal.conversationId !== undefined ? { conversationId: proposal.conversationId } : {}),
      ...(proposal.previousProposalId ? { previousProposalId: proposal.previousProposalId } : {}),
      ...(proposal.folder !== undefined ? { folder: proposal.folder } : {}),
      ...commanderFields(proposal),
      ...(proposal.change ? { change: { ...proposal.change, args: { ...proposal.change.args } } } : {}),
      ...(proposal.edits ? { edits: proposal.edits } : {}),
      ...(proposal.domainEdits ? { domainEdits: proposal.domainEdits } : {}),
      ...(proposal.memoryEdits ? { memoryEdits: proposal.memoryEdits } : {}),
      ...(proposal.card ? { card: proposal.card } : {}),
      ...(proposal.cleanup ? { cleanup: proposal.cleanup } : {}),
      ...(proposal.review ? { review: proposal.review } : {}),
      status: proposal.status,
      result: proposal.result ? { path: proposal.result.path } : undefined,
    })),
  }))
}

function isProposal(value: unknown): value is PersistedProposal {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return typeof p.id === 'string' && (p.kind === 'note' || p.kind === 'task' || p.kind === 'event')
    && typeof p.title === 'string' && typeof p.body === 'string' && typeof p.due === 'string' && typeof p.time === 'string'
    && (p.slot === undefined || (p.kind === 'event' && isSlotTarget(p.slot)))
    && Array.isArray(p.tags) && (p.status === 'wait' || p.status === 'ok' || p.status === 'no')
}

// Fork（almanac ALMNC-54.6）：指揮官提案的來源資料源、筆記類型、領域、相關的人、專案與撰寫者。
// 存檔與讀檔共用：型別不對的欄位只丟那個欄位，提案本身留著。
type CommanderFields = Pick<Proposal, 'sourceIds' | 'noteType' | 'domains' | 'people' | 'project' | 'drafter'>
const DRAFTER_ROLES = ['commander', 'expert', 'secretary']
const COMMANDER_KEYS = ['sourceIds', 'noteType', 'domains', 'people', 'project', 'drafter'] as const

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  return items.length ? items : undefined
}

function commanderFields(raw: Record<string, unknown> | Proposal): CommanderFields {
  const value = raw as Record<string, unknown>
  const out: CommanderFields = {}
  const sourceIds = stringArray(value.sourceIds)
  if (sourceIds) out.sourceIds = sourceIds
  if (typeof value.noteType === 'string' && (NOTE_TYPES as readonly string[]).includes(value.noteType)) out.noteType = value.noteType as CommanderFields['noteType']
  const domains = stringArray(value.domains)
  if (domains) out.domains = domains
  const people = stringArray(value.people)
  if (people) out.people = people
  if (typeof value.project === 'string' && value.project.trim()) out.project = value.project
  const drafter = value.drafter as Record<string, unknown> | undefined
  if (drafter && typeof drafter === 'object' && typeof drafter.role === 'string' && DRAFTER_ROLES.includes(drafter.role)) {
    out.drafter = {
      role: drafter.role as NonNullable<CommanderFields['drafter']>['role'],
      ...(typeof drafter.agentId === 'string' && drafter.agentId ? { agentId: drafter.agentId } : {}),
    }
  }
  return out
}

// Fork（almanac ALMNC-54.7）：右側欄指揮官的檔案變更提案。欄位不齊（例如手動改壞 store.json）就丟掉整個 change，
// 提案留著也不能接受，所以連同提案一起丟（見 isProposal 之後的 filter）。
const CHANGE_KINDS = ['create', 'update', 'delete', 'move', 'copy', 'folder']

function fileChange(value: unknown): FileChange | undefined {
  if (!value || typeof value !== 'object') return undefined
  const c = value as Record<string, unknown>
  if (typeof c.toolName !== 'string' || !c.toolName || typeof c.path !== 'string' || !c.path) return undefined
  if (typeof c.kind !== 'string' || !CHANGE_KINDS.includes(c.kind) || typeof c.summary !== 'string') return undefined
  if (!c.args || typeof c.args !== 'object' || Array.isArray(c.args)) return undefined
  if (c.baseContent !== null && typeof c.baseContent !== 'string') return undefined
  return {
    toolName: c.toolName,
    args: { ...(c.args as Record<string, unknown>) },
    kind: c.kind as FileChange['kind'],
    path: c.path,
    ...(typeof c.targetPath === 'string' ? { targetPath: c.targetPath } : {}),
    ...(typeof c.content === 'string' ? { content: c.content } : {}),
    baseContent: c.baseContent as string | null,
    summary: c.summary,
  }
}

/** 有 change 欄位但讀不懂的提案：接受不了，整則丟掉。 */
function changeReadable(proposal: PersistedProposal): boolean {
  return (proposal as { change?: unknown }).change === undefined || fileChange(proposal.change) !== undefined
}

/** Fork（almanac ALMNC-54.5）：來源對話與取代關係型別不對時只丟那個欄位，提案本身留著。 */
function cleanLinks(proposal: PersistedProposal): PersistedProposal {
  const { conversationId, previousProposalId, change, folder, ...others } = proposal
  const rest: Record<string, unknown> = { ...others }
  for (const key of COMMANDER_KEYS) delete rest[key]
  const parsedChange = fileChange(change)
  return {
    ...(parsedChange ? { change: parsedChange } : {}),
    ...(rest as Omit<PersistedProposal, 'conversationId' | 'previousProposalId'>),
    ...rest,
    ...(typeof conversationId === 'number' && Number.isInteger(conversationId) ? { conversationId } : {}),
    ...(typeof previousProposalId === 'string' && previousProposalId ? { previousProposalId } : {}),
    // Fork（almanac ALMNC-54.21）：卡片上改過的存放位置；往上跳（..）的不收。
    ...(typeof folder === 'string' && !folder.split('/').includes('..') ? { folder } : {}),
    ...commanderFields(proposal),
  }
}

/** 讀檔後：丟掉壞資料與太舊且已處理完的項目。 */
export function parseItems(value: unknown, now: number): PersistedItem[] {
  if (!Array.isArray(value)) return []
  const out: PersistedItem[] = []
  const today = toDateKey(new Date(now))
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const input = item.input as Record<string, unknown> | undefined
    if (typeof item.id !== 'string' || typeof item.createdAt !== 'number' || !input || typeof input.text !== 'string') continue
    if (input.kind !== 'text' && input.kind !== 'link' && input.kind !== 'image' && input.kind !== 'file') continue
    const proposals = Array.isArray(item.proposals) ? item.proposals.filter(isProposal).filter(changeReadable).map(cleanLinks) : []
    const waiting = proposals.some(proposal => proposal.status === 'wait')
    if (proposals.length && proposals.every(proposal => proposal.slot && proposal.due < today)) continue
    if (!waiting && now - item.createdAt > DECIDED_KEEP_MS) continue
    out.push({
      id: item.id,
      input: { kind: input.kind, text: input.text, name: typeof input.name === 'string' ? input.name : undefined },
      createdAt: item.createdAt,
      state: 'ready',
      source: item.source === 'ai' || item.source === 'rules' ? item.source : undefined,
      recordId: typeof item.recordId === 'number' ? item.recordId : undefined,
      proposals,
    })
  }
  return out
}

/** 新舊合併：以 id 為準，記憶體裡的（本次啟動才送進來的）優先，順序是新的在前。 */
export function mergeItems<T extends { id: string, createdAt: number }>(current: readonly T[], restored: readonly T[]): T[] {
  const ids = new Set(current.map(item => item.id))
  return [...current, ...restored.filter(item => !ids.has(item.id))].sort((a, b) => b.createdAt - a.createdAt)
}

export interface CollectStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<CollectStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export async function loadItems(now: number, storage?: CollectStorage): Promise<PersistedItem[]> {
  const store = storage ?? await defaultStorage()
  return parseItems(await store.get(COLLECT_ITEMS_KEY), now)
}

export async function saveItems(items: readonly ItemLike[], storage?: CollectStorage): Promise<void> {
  const store = storage ?? await defaultStorage()
  await store.set(COLLECT_ITEMS_KEY, serializeItems(items))
  await store.save()
}
