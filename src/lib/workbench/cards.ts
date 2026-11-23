// Fork（almanac ALMNC-54.8）：工作台「審核」分頁的卡片模型與投影。純函式、無 I/O，方便測試。
// 規格：almanac/2026-11-19_proposal_role-data-model.md 第四節「工作台」；介面以 2026-11-20_proposal_v3-workbench_v14.html 為準。
// 一條清單、不分區，依「等你回話 → 逾期 → 提案（舊在前）→ 要你親手整理 → 其他任務」分組排序，上方用五個標籤篩選。
// 卡片本身不存狀態：每次都從各來源（提案投影、筆記庫任務、等你決定的資料源…）現況算出來；先放著另外記（put-aside.ts）。
import type { DecideItem } from '@/lib/decide/project'
import { PROPOSAL_STALE_DAYS, DAY_MS } from '@/lib/proposals/trail'
import type { TaskRef } from '@/lib/vault-index/index-core'
import { batchProposals } from './batch'

/** Fork（almanac ALMNC-54.14）：舊筆記批次卡的鍵（也是先放著的鍵）。 */
export const LEGACY_BATCH_KEY = 'legacy-batch'

/** 標籤：這件事是關於什麼（第四節「標籤」）。 */
export const CARD_LABELS = ['schedule', 'note', 'knowledge', 'source', 'review'] as const
export type CardLabel = typeof CARD_LABELS[number]
export type LabelFilter = 'all' | CardLabel

/** 十一個動詞（卡片右上角）：新增、補充、修改、合併、取代、待查證、封存、改時間、判斷、確認、整理。 */
export const CARD_VERBS = ['add', 'supplement', 'modify', 'merge', 'replace', 'verify', 'archive', 'reschedule', 'judge', 'confirm', 'organize'] as const
export type CardVerb = typeof CARD_VERBS[number]

/** v14 的四個分組，加上排在最後、沒有標題的「其他任務」。 */
export const CARD_GROUPS = ['reply', 'late', 'proposal', 'hand', 'task'] as const
export type CardGroup = typeof CARD_GROUPS[number]

/** 卡片類型決定按鈕（第四節「按鈕代表動作」；資料源卡依 v14 加上照建議處理／自己處理／不採用）。 */
// Fork（almanac ALMNC-54.14）：legacy＝舊筆記批次卡（R3，「舊筆記 1,240 則」）。
// Fork（almanac ALMNC-65.2）：batch＝同一資料源的新知識筆記批次卡（全部接受；逐則接受／退回在卡片裡面）。
// Fork（almanac ALMNC-69.7）：domainLimit＝一則筆記被收錄在超過 3 個領域，請 Scott 選要拿掉哪個（選項＝各領域）。
export type CardKind = 'proposal' | 'reply' | 'hand' | 'task' | 'confirm' | 'source' | 'domain' | 'legacy' | 'batch' | 'domainLimit'

export type CardAction =
  | 'accept' | 'discuss' | 'drop' // 提案
  | 'answer' | 'pick' // 有人在等 Scott 回話
  | 'desk' // 攤到檯面
  | 'schedule' | 'done' // 任務
  | 'stillValid' | 'toCommander' // 確認類
  | 'process' | 'selfProcess' | 'reject' // 等你決定的資料源（R1）
  // Fork（almanac ALMNC-54.10）：「處理」（不帶建議交給指揮官）；擷取失敗的卡片「重試／刪除」。
  // 沒有初步判斷（或判斷沒有建議）時不顯示「照建議處理」，process 改叫「處理」，handle 不出現。
  | 'handle' | 'retry' | 'delete'
  // Fork（almanac ALMNC-54.14）：舊筆記批次卡「開始處理／繼續處理／暫停」；判斷不出來的那一包「整理好了」。
  | 'migrate' | 'resume' | 'pause' | 'packDone'

export const ACTIONS_BY_KIND: Record<CardKind, readonly CardAction[]> = {
  proposal: ['accept', 'discuss', 'drop'],
  domain: ['accept', 'discuss', 'drop'],
  reply: ['answer'],
  hand: ['desk'],
  task: ['schedule', 'done'],
  confirm: ['stillValid', 'toCommander'],
  source: ['process', 'selfProcess', 'reject'],
  legacy: ['migrate'],
  batch: ['accept'],
  domainLimit: ['pick'],
}

/** Fork（almanac ALMNC-54.14）：舊筆記批次卡的按鈕——跑的時候只有「暫停」，否則「開始處理」（處理過一些就是「繼續處理」）。 */
export function legacyCardActions(batch: Pick<LegacyBatchLike, 'running' | 'processed'>): readonly CardAction[] {
  if (batch.running) return ['pause']
  return batch.processed > 0 ? ['resume'] : ['migrate']
}

/** 判斷不出來的那一包：攤到檯面（親手整理）、整理好了。 */
export const PACK_ACTIONS: readonly CardAction[] = ['desk', 'packDone']

/** Fork（almanac ALMNC-54.10）：等你決定的資料源卡的按鈕——有建議：照建議處理／處理／自己處理／不採用；沒有建議：處理／自己處理／不採用；擷取失敗：重試／刪除。 */
export function sourceCardActions(source: Pick<AwaitingSourceLike, 'suggestion' | 'failed'>): readonly CardAction[] {
  if (source.failed) return ['retry', 'delete']
  return source.suggestion ? ['process', 'handle', 'selfProcess', 'reject'] : ACTIONS_BY_KIND.source
}

/** 按鈕上的字：沒有建議時 process 就是「處理」；批次卡的接受是「全部接受」。 */
export function actionLabelKey(card: Pick<WorkbenchCard, 'kind' | 'hasSuggestion'>, action: CardAction): CardAction | 'acceptAll' {
  if (card.kind === 'batch' && action === 'accept') return 'acceptAll'
  return card.kind === 'source' && action === 'process' && !card.hasSuggestion ? 'handle' : action
}

/** 單鍵：主要動作一律 A（v14 鍵盤列「A 接受」），其餘照 v14。 */
export const ACTION_KEY: Partial<Record<CardAction, string>> = {
  accept: 'A', process: 'A', stillValid: 'A', schedule: 'A', answer: 'A',
  discuss: 'D', toCommander: 'D',
  drop: 'X', reject: 'X',
  done: 'C',
  desk: 'T',
  handle: 'P', retry: 'R',
  migrate: 'A', resume: 'A', packDone: 'C',
}

export interface WorkbenchCard {
  /** 唯一鍵，也是先放著記錄的鍵。 */
  key: string
  kind: CardKind
  group: CardGroup
  label: CardLabel
  verb: CardVerb
  /** 標的物（第一行）。 */
  title: string
  /** 多個標的物時「等 N 則」的 N。 */
  more?: number
  /** 第二行：資料夾路徑或時間。 */
  path?: string
  /** 第三行：誰建議的＋內容摘要。 */
  summary: string
  /** 誰建議的（角色本名或「系統」）；沒有就不顯示。 */
  by?: string
  /** 進來的時間（排序與「等多久」）。 */
  at: number
  overdue?: boolean
  /** Fork（almanac ALMNC-54.21）：沒排日期的任務（排在其他任務最後，不顯示等多久）。 */
  undated?: boolean
  actions: readonly CardAction[]
  conversationId?: number
  /** 回話卡的選項（「選一個」）。 */
  choices?: readonly string[]
  // —— 回到來源用的參照 ——
  decide?: DecideItem
  task?: TaskLike
  sourceId?: string
  notePath?: string
  notePaths?: readonly string[]
  domainProposalId?: string
  /** Fork（almanac ALMNC-54.10）：資料源卡有初步判斷的建議（「照建議處理」才出現）。 */
  hasSuggestion?: boolean
  /** Fork（almanac ALMNC-54.14）：舊筆記批次卡的進度。 */
  legacy?: LegacyBatchLike
  /** Fork（almanac ALMNC-54.14）：判斷不出來的那一包（批次 id）。 */
  packId?: string
  /** Fork（almanac ALMNC-65.2）：批次卡裡的每一則新知識筆記（依原順序）。 */
  batch?: readonly DecideItem[]
}

// —— 投影輸入（結構型別，不綁 store） ——

/** 筆記庫索引裡的任務（逾期、還沒排時間的）。 */
export type TaskLike = TaskRef

export interface AwaitingSourceLike {
  id: string
  /** 顯示用的標的物：原始檔名、網頁標題或「截圖 · 11/19 14:03」。 */
  title: string
  kindLabel: string
  /** 初步判斷（R1）一行「類型｜建議」；本機模型無法使用時是空字串（AC#4：卡片照樣出現）。 */
  judgement: string
  /** Fork（almanac ALMNC-54.10）：判斷裡的建議（沒有就不顯示「照建議處理」）。 */
  suggestion?: string
  /** Fork（almanac ALMNC-54.10）：擷取失敗（連結抓不到內文）→ 重試／刪除。 */
  failed?: boolean
  /** 來處（網址、檔名）；沒有初步判斷時當第三行。 */
  origin?: string
  collectedAt: number
}

export interface ReplyLike {
  key: string
  title: string
  summary: string
  by?: string
  at: number
  conversationId?: number
  choices?: readonly string[]
}

export interface HandLike {
  key: string
  label: Extract<CardLabel, 'knowledge' | 'source'>
  title: string
  more?: number
  summary: string
  by?: string
  at: number
  notePaths?: readonly string[]
  /** Fork（almanac ALMNC-54.14）：舊筆記判斷不出來的那一包；有的話多一個「整理好了」。 */
  packId?: string
}

/** Fork（almanac ALMNC-54.14）：舊筆記批次（R3）。total＝已標記＋還沒標記的舊筆記；processed＝已分析或不採用。 */
export interface LegacyBatchLike {
  /** 「舊筆記 1,240 則」（依語系組好）。 */
  title: string
  /** 「上線時轉入 · 分批交給 Mia」或「已處理 M / N」（依語系組好）。 */
  summary: string
  total: number
  processed: number
  running: boolean
  /** 正在停（這一則做完就停）。 */
  pausing?: boolean
  /** 每批幾則（卡片說明用）。 */
  batchSize?: number
  /** 分批交給誰（指揮官本名）。 */
  by?: string
  /** 最早標記的時間；還沒標記就是現在。 */
  at: number
}

export interface ConfirmLike {
  path: string
  title: string
  /** YYYY-MM-DD。 */
  lastConfirmed: string
  /** Fork（almanac ALMNC-54.12）：依領域期限算出的到期日，YYYY-MM-DD。 */
  dueDate?: string
  by?: string
}

export interface DomainLike {
  id: string
  title: string
  summary: string
  notePaths: readonly string[]
  by?: string
  at: number
}

/** Fork（almanac ALMNC-69.7）：收錄超過 3 個領域的筆記（lib/moc 重建時發現，不自動砍）。 */
export interface DomainLimitLike {
  notePath: string
  title: string
  /** 目前收錄它的領域（依 domains 順序，第一個是主要）；卡片上一個領域一個選項。 */
  domains: readonly string[]
  summary: string
  by?: string
  at: number
}

export interface ReviewInput {
  proposals: readonly DecideItem[]
  overdueTasks?: readonly TaskLike[]
  /** 還沒逾期的任務（今天以後到期的、沒排日期的都在這裡；沒日期的會排到最後）。 */
  otherTasks?: readonly TaskLike[]
  awaitingSources?: readonly AwaitingSourceLike[]
  replies?: readonly ReplyLike[]
  hand?: readonly HandLike[]
  confirm?: readonly ConfirmLike[]
  domains?: readonly DomainLike[]
  domainLimits?: readonly DomainLimitLike[]
  /** Fork（almanac ALMNC-54.14）：還有舊筆記沒處理時才給。 */
  legacy?: LegacyBatchLike
  now: number
}

// —— 對應規則 ——

function folderOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : ''
}

function baseName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

/** 提案的標籤：日程（任務、時段）、知識（領域）、回顧（超過 14 天沒決定）、其他都是筆記。 */
export function proposalLabel(item: DecideItem, now: number): CardLabel {
  if (now - item.at >= PROPOSAL_STALE_DAYS * DAY_MS) return 'review'
  // Fork（almanac ALMNC-54.12）：清理提案（同領域打包＝知識）、確認、每週回顧由提案自己指定標籤。
  if (item.card) return item.card.label
  if (item.kind === 'task' || item.kind === 'event') return 'schedule'
  return 'note'
}

/** 提案的動詞（十一個之一）。 */
export function proposalVerb(item: DecideItem): CardVerb {
  if (item.card) return item.card.verb
  if (item.organizeMerge) return 'merge'
  switch (item.kind) {
    case 'task':
    case 'event':
      // 排進今日日誌既有任務的時段提案（scheduler）是檔案差異預覽：改時間；其餘是新任務。
      return item.preview.type === 'file' ? 'reschedule' : 'add'
    case 'update': return 'modify'
    case 'delete': return 'archive'
    case 'move': return 'organize'
    case 'job': return 'confirm'
    default: return 'add'
  }
}

export function proposalCard(item: DecideItem, now: number): WorkbenchCard {
  // Fork（almanac ALMNC-54.12）：自己指定卡片的提案（清理、確認、回顧）標題就是標的物，第二行是第一則筆記的資料夾。
  const fileLike = !item.card && (item.source === 'draft' || (item.preview.type === 'file' && item.kind !== 'task' && item.kind !== 'event'))
  const title = item.source === 'draft' ? item.summary || baseName(item.title) : fileLike ? baseName(item.title) : item.title
  const cardFolder = item.card && item.preview.type === 'file' ? folderOf(item.preview.path) : ''
  const path = item.when || (fileLike ? folderOf(item.preview.type === 'file' ? item.preview.path : item.title) : cardFolder)
  return {
    key: item.key,
    kind: 'proposal',
    group: 'proposal',
    label: proposalLabel(item, now),
    verb: proposalVerb(item),
    title,
    more: (item.notePaths && item.notePaths.length > 1 ? item.notePaths.length - 1 : item.duplicates.length) || undefined,
    path: path || undefined,
    summary: item.source === 'draft' ? item.origin : item.summary || item.origin,
    at: item.at,
    actions: ACTIONS_BY_KIND.proposal,
    ...(item.conversationId !== undefined ? { conversationId: item.conversationId } : {}),
    decide: item,
    ...(item.notePaths?.length ? { notePaths: item.notePaths } : {}),
  }
}

/** Fork（almanac ALMNC-69.7）：超過上限卡的鍵（也是先放著的鍵）。 */
export function domainLimitCardKey(notePath: string): string {
  return `domain-limit:${notePath}`
}

/** Fork（almanac ALMNC-65.2）：批次卡的鍵（也是先放著的鍵）。 */
export function batchCardKey(sourceKey: string): string {
  return `batch:${sourceKey}`
}

/**
 * Fork（almanac ALMNC-65.2）：同一資料源的新知識筆記批次卡。第一行是第一則的標題「等 N 則」，第三行是來源（資料源名稱）；
 * 標籤照第一則（超過 14 天沒決定就是回顧），動詞是新增。時間取最早的一則。
 */
function batchCard(sourceKey: string, items: readonly DecideItem[], now: number): WorkbenchCard {
  const first = items[0]!
  return {
    key: batchCardKey(sourceKey),
    kind: 'batch',
    group: 'proposal',
    label: first.mocReview ? 'knowledge' : proposalLabel(first, now),
    verb: first.mocReview ? 'organize' : 'add',
    title: first.mocReview?.name ?? first.title,
    more: first.mocReview ? undefined : items.length - 1,
    summary: first.mocReview?.week ?? first.origin,
    at: Math.min(...items.map(item => item.at)),
    actions: first.mocReview ? [] : ACTIONS_BY_KIND.batch,
    ...(first.conversationId !== undefined ? { conversationId: first.conversationId } : {}),
    batch: items,
  }
}

/** Fork（almanac ALMNC-65.2）：批次卡裡的某一則，組回原本的單張提案卡（逐則接受、退回時用同一套動作）。 */
export function memberCard(card: Pick<WorkbenchCard, 'batch'>, itemKey: string, now: number): WorkbenchCard | null {
  const item = card.batch?.find(entry => entry.key === itemKey)
  return item ? proposalCard(item, now) : null
}

function taskWhen(task: TaskLike): string {
  const m = task.due.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return [m ? `${Number(m[1])}/${Number(m[2])}` : task.due, task.time].filter(Boolean).join(' ')
}

function taskCard(task: TaskLike, group: 'late' | 'task', now: number): WorkbenchCard {
  const dueAt = task.due ? Date.parse(`${task.due}T00:00:00`) : now
  return {
    key: `task:${task.path}:${task.line}`,
    kind: 'task',
    group,
    label: 'schedule',
    verb: 'reschedule',
    title: task.title,
    path: taskWhen(task) || folderOf(task.path) || undefined,
    summary: baseName(task.path),
    at: Number.isFinite(dueAt) ? dueAt : now,
    overdue: group === 'late',
    ...(task.due ? {} : { undated: true }),
    actions: ACTIONS_BY_KIND.task,
    task,
  }
}

/** 投影：把各來源現況變成卡片。順序就是清單順序（見 sortCards）。 */
export function buildReviewCards(input: ReviewInput): WorkbenchCard[] {
  const { now } = input
  const cards: WorkbenchCard[] = []
  for (const reply of input.replies ?? []) {
    cards.push({
      key: reply.key, kind: 'reply', group: 'reply', label: 'schedule', verb: 'confirm',
      title: reply.title, summary: reply.summary, by: reply.by, at: reply.at,
      actions: reply.choices?.length ? ['pick', 'answer'] : ACTIONS_BY_KIND.reply,
      ...(reply.choices?.length ? { choices: reply.choices } : {}),
      ...(reply.conversationId !== undefined ? { conversationId: reply.conversationId } : {}),
    })
  }
  for (const task of input.overdueTasks ?? []) cards.push(taskCard(task, 'late', now))
  // Fork（almanac ALMNC-65.2）：同一資料源兩則以上的新知識筆記合成一張批次卡（只是投影，提案本身不變）。
  for (const entry of batchProposals(input.proposals)) {
    cards.push(entry.type === 'batch' ? batchCard(entry.key, entry.items, now) : proposalCard(entry.item, now))
  }
  for (const source of input.awaitingSources ?? []) {
    cards.push({
      key: `source:${source.id}`, kind: 'source', group: 'proposal', label: 'source', verb: 'judge',
      title: source.title, path: source.kindLabel, summary: source.judgement || source.origin || '', at: source.collectedAt,
      actions: sourceCardActions(source), sourceId: source.id,
      ...(source.suggestion && !source.failed ? { hasSuggestion: true } : {}),
    })
  }
  for (const domain of input.domains ?? []) {
    cards.push({
      key: domain.id, kind: 'domain', group: 'proposal', label: 'knowledge', verb: 'add',
      title: domain.title, summary: domain.summary, by: domain.by, at: domain.at,
      more: domain.notePaths.length > 1 ? domain.notePaths.length - 1 : undefined,
      actions: ACTIONS_BY_KIND.domain, notePaths: domain.notePaths, domainProposalId: domain.id,
    })
  }
  for (const limit of input.domainLimits ?? []) {
    cards.push({
      key: domainLimitCardKey(limit.notePath), kind: 'domainLimit', group: 'proposal', label: 'knowledge', verb: 'organize',
      title: limit.title, path: folderOf(limit.notePath) || undefined, summary: limit.summary, by: limit.by, at: limit.at,
      actions: ACTIONS_BY_KIND.domainLimit, choices: limit.domains, notePath: limit.notePath,
    })
  }
  for (const note of input.confirm ?? []) {
    const at = Date.parse(`${note.lastConfirmed}T00:00:00`)
    cards.push({
      key: `confirm:${note.path}`, kind: 'confirm', group: 'proposal', label: 'note', verb: 'confirm',
      title: note.title, path: folderOf(note.path) || undefined, summary: note.lastConfirmed, by: note.by,
      at: Number.isFinite(at) ? at : now, actions: ACTIONS_BY_KIND.confirm, notePath: note.path,
    })
  }
  for (const hand of input.hand ?? []) {
    cards.push({
      key: hand.key, kind: 'hand', group: 'hand', label: hand.label, verb: 'organize',
      title: hand.title, more: hand.more, summary: hand.summary, by: hand.by, at: hand.at,
      actions: hand.packId ? PACK_ACTIONS : ACTIONS_BY_KIND.hand, notePaths: hand.notePaths,
      ...(hand.packId ? { packId: hand.packId } : {}),
    })
  }
  // Fork（almanac ALMNC-54.14）：舊筆記合成一張卡（v14：要你親手整理・資料源・整理・系統）。標題與進度字由畫面依語系組（legacy 欄位）。
  if (input.legacy && input.legacy.total > input.legacy.processed) {
    const legacy = input.legacy
    cards.push({
      key: LEGACY_BATCH_KEY, kind: 'legacy', group: 'hand', label: 'source', verb: 'organize',
      title: legacy.title, summary: legacy.summary, by: legacy.by, at: legacy.at, actions: legacyCardActions(legacy), legacy,
    })
  }
  for (const task of input.otherTasks ?? []) cards.push(taskCard(task, 'task', now))
  return sortCards(cards)
}

/** 排序：分組依序；逾期任務最久的在前、提案舊的在前；其他任務照到期日，沒排日期的在最後；同一時間維持輸入順序。 */
export function sortCards(cards: readonly WorkbenchCard[]): WorkbenchCard[] {
  const rank = new Map(CARD_GROUPS.map((group, index) => [group, index]))
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (rank.get(a.card.group)! - rank.get(b.card.group)!)
      || (Number(Boolean(a.card.undated)) - Number(Boolean(b.card.undated)))
      || (a.card.at - b.card.at) || (a.index - b.index))
    .map(entry => entry.card)
}

export function filterCards(cards: readonly WorkbenchCard[], filter: LabelFilter): WorkbenchCard[] {
  return filter === 'all' ? [...cards] : cards.filter(card => card.label === filter)
}

/** 各篩選的件數（全部＋五個標籤）。 */
export function labelCounts(cards: readonly WorkbenchCard[]): Record<LabelFilter, number> {
  const counts: Record<LabelFilter, number> = { all: cards.length, schedule: 0, note: 0, knowledge: 0, source: 0, review: 0 }
  for (const card of cards) counts[card.label]++
  return counts
}

/** 依分組切開（畫面每組一個標題；「其他任務」沒有標題，接在最後）。 */
export function groupCards(cards: readonly WorkbenchCard[]): Array<{ group: CardGroup, cards: WorkbenchCard[] }> {
  const out: Array<{ group: CardGroup, cards: WorkbenchCard[] }> = []
  for (const card of cards) {
    const last = out[out.length - 1]
    if (last?.group === card.group) last.cards.push(card)
    else out.push({ group: card.group, cards: [card] })
  }
  return out
}

/** 鍵盤：在目前這張卡上找某個單鍵對應的動作。 */
export function actionForKey(card: WorkbenchCard, key: string): CardAction | undefined {
  const upper = key.toUpperCase()
  return card.actions.find(action => ACTION_KEY[action] === upper)
}

/** 處理完一張後游標移到哪一張：下一張，沒有就上一張。 */
export function nextCursor(visible: readonly WorkbenchCard[], doneKey: string): string | null {
  const index = visible.findIndex(card => card.key === doneKey)
  if (index < 0) return visible[0]?.key ?? null
  return visible[index + 1]?.key ?? visible[index - 1]?.key ?? null
}

/** 「等多久」的短字：剛剛、3 小時、2 天。 */
export function ageParts(at: number, now: number): { unit: 'now' | 'hour' | 'day', value: number } {
  const diff = Math.max(0, now - at)
  if (diff < 3_600_000) return { unit: 'now', value: 0 }
  if (diff < DAY_MS) return { unit: 'hour', value: Math.floor(diff / 3_600_000) }
  return { unit: 'day', value: Math.floor(diff / DAY_MS) }
}
