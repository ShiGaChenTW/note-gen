// Fork（almanac ALMNC-65.1）：提案的風險等級。純函式、不呼叫模型——只看動作類型（卡片動詞）與改動內容。
// 規格：almanac/2026-11-23_proposal_note-type-rules.md 第四節原則 6 與第七節第 12 條：
// 唯一的低風險是「補一則一般連結」——不改內文其他部分、不改歸屬（frontmatter、MOC 收錄）；其他一律高風險，判斷不出來也算高。
// 低風險才可能自動接受（ALMNC-65.3），所以這裡寧可誤判成高。
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import type { CardVerb, WorkbenchCard } from './cards'

export type Risk = 'low' | 'high'

/**
 * 提案接受後會改到的一份內容（完整前後文，不是截短的預覽）。
 * target：note＝筆記庫檔案；domain＝領域總覽；memory＝角色記憶（工作筆記、規則、目前脈絡）。
 * before 為 null＝原本不存在（新增）；after 為 null＝刪除，或內容無法預先得知（搬移、複製、新增資料夾）。
 */
export interface ContentChange {
  target: 'note' | 'domain' | 'memory'
  path: string
  before: string | null
  after: string | null
}

export interface RiskSubject {
  /** 卡片動詞；不認得的值一律高風險。 */
  verb: CardVerb | string | undefined
  /** 接受後的所有改動；沒有給（或空）＝判斷不出改了什麼，算高風險。 */
  changes?: readonly ContentChange[]
}

/** 名義上可能是「補連結」的動詞：補充、修改。其他動詞（新增、合併、取代、封存、改時間…）不看內容，直接高風險。 */
export const LINK_CANDIDATE_VERBS: readonly CardVerb[] = ['supplement', 'modify']

export function riskOf(card: RiskSubject): Risk {
  if (!card.verb || !(LINK_CANDIDATE_VERBS as readonly string[]).includes(card.verb)) return 'high'
  const changes = card.changes ?? []
  if (changes.length !== 1) return 'high'
  const [change] = changes
  if (change.target !== 'note' || change.before === null || change.after === null) return 'high'
  return isSingleLinkAddition(change.before, change.after) ? 'low' : 'high'
}

/** 工作台卡片的風險：動詞＋提案帶的完整改動（card.decide.changes）。不是提案的卡片沒有改動，算高風險。 */
export function cardRisk(card: Pick<WorkbenchCard, 'verb' | 'decide'>): Risk {
  return riskOf({ verb: card.verb, changes: card.decide?.changes })
}

// —— 內容判斷 ——

const WIKILINK = /(!?)\[\[([^\[\]\n]+?)\]\]/g

/** MOC（領域頁）：frontmatter 有 `kind: domain` 或 M 編號。在 MOC 上加的連結可能是正式收錄（改歸屬），一律不算一般連結。 */
export function isMocContent(content: string): boolean {
  const { block } = splitFrontmatter(content)
  return /^kind:\s*['"]?domain['"]?\s*(#.*)?$/m.test(block) || /^id:\s*['"]?M-/m.test(block)
}

/** 比較用：空白（含換行、空行）不算內容。 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 拿掉一個連結：連結前緊鄰的分隔符號（、，,；;）與空白一起拿掉；那一行只剩清單符號時整行拿掉。 */
function withoutLink(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && /[ \t]/.test(text[from - 1])) from--
  if (from > 0 && /[、，,；;]/.test(text[from - 1])) from--
  const removed = text.slice(0, from) + text.slice(end)
  const lineStart = removed.lastIndexOf('\n', from - 1) + 1
  const nextBreak = removed.indexOf('\n', from)
  const lineEnd = nextBreak < 0 ? removed.length : nextBreak
  if (/^\s*(?:[-*+]|\d+[.)])?\s*$/.test(removed.slice(lineStart, lineEnd))) return removed.slice(0, lineStart) + removed.slice(lineEnd)
  return removed
}

/** `[[目標#標題|顯示字]]` 在畫面上顯示的字（把提及改成連結時，原文就是這個字）。 */
function displayText(inner: string): string {
  const pipe = inner.indexOf('|')
  if (pipe >= 0) return inner.slice(pipe + 1)
  const hash = inner.indexOf('#')
  return hash >= 0 ? inner.slice(0, hash) : inner
}

/**
 * after 是不是 before 只多了一則一般連結：
 * - frontmatter 一個字都不能動（domains、type、parent、sources 都在裡面＝歸屬與身分）；
 * - 不是 MOC；
 * - 內文只差一個 `[[…]]`：要嘛是新插入的（可以獨占一行清單項目），要嘛是把原文裡的提及包成連結；
 * - 嵌入（`![[…]]`）不算一般連結。
 */
export function isSingleLinkAddition(before: string, after: string): boolean {
  if (before === after) return false
  if (isMocContent(before) || isMocContent(after)) return false
  const a = splitFrontmatter(before)
  const b = splitFrontmatter(after)
  if (a.block !== b.block) return false
  const target = normalize(a.body)
  const bodyLinks = (text: string) => [...text.matchAll(WIKILINK)].length
  if (bodyLinks(b.body) !== bodyLinks(a.body) + 1) return false
  for (const match of b.body.matchAll(WIKILINK)) {
    if (match[1] === '!') continue
    const start = match.index
    const end = start + match[0].length
    if (normalize(withoutLink(b.body, start, end)) === target) return true
    const shown = displayText(match[2]).trim()
    if (shown && normalize(b.body.slice(0, start) + shown + b.body.slice(end)) === target) return true
  }
  return false
}
