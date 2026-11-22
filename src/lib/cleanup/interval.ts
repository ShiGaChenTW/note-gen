// Fork（almanac ALMNC-54.12）：重新確認頻率。依領域設定，寫在負責專家的 rules.md（例如「- 重新確認頻率：6 個月」）；
// 沒寫就用預設：技術類 6 個月、一般知識 1 年。最後確認日期超過期限的知識筆記，在工作台出現確認卡（仍然有效／交給指揮官）。
// 純函式，日期都用本地時區的 YYYY-MM-DD。
import type { ConfirmLike } from '@/lib/workbench/cards'

export type IntervalUnit = 'day' | 'week' | 'month' | 'year'

export interface ReconfirmInterval {
  amount: number
  unit: IntervalUnit
  /** rules：專家的 rules.md 寫的；default：預設值。 */
  from: 'rules' | 'default'
}

export const GENERAL_INTERVAL: ReconfirmInterval = { amount: 1, unit: 'year', from: 'default' }
export const TECHNICAL_INTERVAL: ReconfirmInterval = { amount: 6, unit: 'month', from: 'default' }

/** 領域名稱看起來是技術類（預設 6 個月）。 */
const TECHNICAL = /工程|技術|程式|軟體|軟件|資料|数据|資訊|信息|系統|系统|網路|网络|開發|开发|演算法|算法|AI|ML|LLM|tech|engineer|software|program|code|coding|data|dev|cloud|security|資安|機器學習|机器学习|人工智慧|人工智能/i

const UNIT_WORDS: Array<[RegExp, IntervalUnit]> = [
  [/^(天|日|days?|d)$/i, 'day'],
  [/^(週|周|星期|個?禮拜|weeks?|w)$/i, 'week'],
  [/^(個月|个月|月|months?|mo)$/i, 'month'],
  [/^(年|years?|y)$/i, 'year'],
]

const RULE_LINE = /(?:重新確認|重新确认|reconfirm(?:ation)?)(?:頻率|频率|期限|間隔|间隔|週期|周期|\s*interval|\s*every)?\s*[:：]?\s*(?:每\s*)?(\d+(?:\.\d+)?|一|二|兩|两|三|六|十二)\s*(個月|个月|天|日|週|周|星期|禮拜|個禮拜|月|年|days?|weeks?|months?|years?)/i

const CHINESE_NUMBER: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 六: 6, 十二: 12 }

/** 從 rules.md 找「重新確認頻率：6 個月」這類寫法；找不到回傳 undefined。 */
export function parseReconfirmInterval(rules: string | undefined | null): ReconfirmInterval | undefined {
  if (!rules) return undefined
  for (const line of rules.split(/\r?\n/)) {
    const match = line.match(RULE_LINE)
    if (!match) continue
    const amount = CHINESE_NUMBER[match[1]] ?? Number(match[1])
    const unit = UNIT_WORDS.find(([re]) => re.test(match[2].trim()))?.[1]
    if (!unit || !Number.isFinite(amount) || amount <= 0) continue
    return { amount: Math.round(amount), unit, from: 'rules' }
  }
  return undefined
}

export function defaultInterval(domainName: string | undefined): ReconfirmInterval {
  return domainName && TECHNICAL.test(domainName) ? TECHNICAL_INTERVAL : GENERAL_INTERVAL
}

/** rules.md 裡的寫法，例如「6 個月」「1 年」（parseReconfirmInterval 讀得回來）。 */
export function formatInterval(interval: Pick<ReconfirmInterval, 'amount' | 'unit'>): string {
  return `${interval.amount} ${{ day: '天', week: '週', month: '個月', year: '年' }[interval.unit]}`
}

/** 期限換算成天數（只用來比較長短）。 */
export function intervalDays(interval: Pick<ReconfirmInterval, 'amount' | 'unit'>): number {
  const per = { day: 1, week: 7, month: 30, year: 365 }[interval.unit]
  return interval.amount * per
}

function parseYmd(ymd: string): Date | undefined {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return undefined
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(date.getTime()) ? date : undefined
}

export function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 到期日：最後確認日期＋期限（月、年照日曆加；月底會落到下個月的最後一天以內）。 */
export function dueDate(lastConfirmed: string, interval: Pick<ReconfirmInterval, 'amount' | 'unit'>): string | undefined {
  const base = parseYmd(lastConfirmed)
  if (!base) return undefined
  const date = new Date(base)
  if (interval.unit === 'day') date.setDate(date.getDate() + interval.amount)
  else if (interval.unit === 'week') date.setDate(date.getDate() + interval.amount * 7)
  else {
    const months = interval.unit === 'month' ? interval.amount : interval.amount * 12
    const day = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() + months)
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(day, last))
  }
  return ymd(date)
}

/** 今天（含）已到期。 */
export function isOverdue(lastConfirmed: string, interval: Pick<ReconfirmInterval, 'amount' | 'unit'>, today: string): boolean {
  const due = dueDate(lastConfirmed, interval)
  return due !== undefined && due <= today
}

export interface ExpertRules {
  /** 專家負責的領域名稱。 */
  domain?: string
  rules: string
}

function normalize(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

/** 每個領域的期限：負責專家的 rules.md 有寫就用它，否則依領域名稱給預設。下層領域沒有專家時沿用上層的專家。 */
export function intervalsByDomain(
  domains: ReadonlyArray<{ id: string, name: string, parentId?: string }>,
  experts: readonly ExpertRules[],
): Map<string, ReconfirmInterval> {
  const ruleOf = new Map<string, ReconfirmInterval>()
  for (const expert of experts) {
    const parsed = parseReconfirmInterval(expert.rules)
    if (parsed && expert.domain) ruleOf.set(normalize(expert.domain), parsed)
  }
  const out = new Map<string, ReconfirmInterval>()
  for (const domain of domains) {
    const parent = domain.parentId ? domains.find(item => item.id === domain.parentId) : undefined
    out.set(domain.id, ruleOf.get(normalize(domain.name)) ?? (parent && ruleOf.get(normalize(parent.name))) ?? defaultInterval(domain.name))
  }
  return out
}

/** 一則筆記屬於多個領域時取最短的期限；沒有領域用一般知識的 1 年。 */
export function intervalForNote(domainIds: readonly string[], intervals: ReadonlyMap<string, ReconfirmInterval>): ReconfirmInterval {
  const found = domainIds.map(id => intervals.get(id)).filter((entry): entry is ReconfirmInterval => !!entry)
  if (!found.length) return GENERAL_INTERVAL
  return found.reduce((best, entry) => intervalDays(entry) < intervalDays(best) ? entry : best)
}

export interface IndexedNoteForConfirm {
  path: string
  frontmatter: Record<string, unknown> | null
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map(entry => entry.trim())
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function titleOf(note: IndexedNoteForConfirm): string {
  const title = note.frontmatter?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  return (note.path.split('/').pop() ?? note.path).replace(/\.md$/i, '')
}

export interface ConfirmDue extends ConfirmLike {
  dueDate: string
  domains: string[]
}

/**
 * 最後確認日期超過領域期限的知識筆記（舊的在前）。已被取代、封存的不列；沒有最後確認日期的不列。
 * until 給了就改成「到 until 為止會到期的」（每週回顧列「這週到期的筆記」用）。
 */
export function notesDueForConfirm(
  notes: Iterable<IndexedNoteForConfirm>,
  intervals: ReadonlyMap<string, ReconfirmInterval>,
  today: string,
  options: { until?: string } = {},
): ConfirmDue[] {
  const limit = options.until ?? today
  const out: ConfirmDue[] = []
  for (const note of notes) {
    const fm = note.frontmatter
    const last = fm?.lastConfirmed instanceof Date ? ymd(fm.lastConfirmed) : fm?.lastConfirmed
    if (fm?.type !== 'knowledge' || typeof last !== 'string' || !parseYmd(last)) continue
    if (fm.status === 'archived' || fm.status === 'superseded') continue
    const domains = strings(fm.domains)
    const due = dueDate(last, intervalForNote(domains, intervals))
    if (!due || due > limit) continue
    out.push({ path: note.path, title: titleOf(note), lastConfirmed: last, dueDate: due, domains })
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.path.localeCompare(b.path))
}
