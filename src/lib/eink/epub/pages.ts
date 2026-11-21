// Fork（almanac ALMNC-48）：「頁」的估算與精選文章正文的截斷。
// 一頁 = CHARS_PER_PAGE 個字的預算（params.ts 有依據與待驗證的點）；
// 中日韓字元算 1、其他非空白字元算 0.5、空白不算；一張圖算 IMAGE_PAGE_COST 頁。
import { markdownBlocks, markdownImageUrls } from './markdown'
import { ARTICLE_MAX_PAGES, CHARS_PER_PAGE, IMAGE_PAGE_COST } from './params'

export interface PageBudget {
  charsPerPage: number
  imagePageCost: number
}

export const DEFAULT_PAGE_BUDGET: PageBudget = { charsPerPage: CHARS_PER_PAGE, imagePageCost: IMAGE_PAGE_COST }

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\uD840-\uD87F][\uDC00-\uDFFF]/

/** 文字的字數單位：中日韓（含全形標點）算 1，其他非空白算 0.5。 */
export function textUnits(text: string): number {
  let units = 0
  for (const char of text) {
    if (/\s/.test(char)) continue
    units += WIDE.test(char) ? 1 : 0.5
  }
  return units
}

/** Markdown 的字數單位：去掉圖片與連結網址、標記符號後算字，再加上圖片。 */
export function markdownUnits(markdown: string, budget: PageBudget = DEFAULT_PAGE_BUDGET): number {
  const images = markdownImageUrls(markdown).length
  const text = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, '')
  return textUnits(text) + images * budget.imagePageCost * budget.charsPerPage
}

export function unitsToPages(units: number, budget: PageBudget = DEFAULT_PAGE_BUDGET): number {
  return units / budget.charsPerPage
}

export interface TruncatedMarkdown {
  /** 放在章節裡的部分 */
  head: string
  /** 截掉、要放附錄的部分；沒截時為 null */
  rest: string | null
}

const SENTENCE_END = /[。！？!?．.…]["」』）)]*\s*/g

/** 單一段落就超過預算時，退而求其次截在句子邊界（至少保留一句）。 */
function splitLongBlock(block: string, maxUnits: number): [string, string] | null {
  let cut = -1
  let match: RegExpExecArray | null
  SENTENCE_END.lastIndex = 0
  while ((match = SENTENCE_END.exec(block))) {
    const end = match.index + match[0].length
    if (textUnits(block.slice(0, end)) > maxUnits) break
    cut = end
  }
  if (cut <= 0 || cut >= block.length) return null
  return [block.slice(0, cut).trim(), block.slice(cut).trim()]
}

/**
 * 正文超過 maxPages 頁就截在段落邊界（頂層區塊之間）：前面放章節、其餘放附錄。
 * 至少保留第一段；第一段本身就超過預算時才截在句子邊界。
 */
export function truncateMarkdown(markdown: string, maxPages = ARTICLE_MAX_PAGES, budget: PageBudget = DEFAULT_PAGE_BUDGET): TruncatedMarkdown {
  const maxUnits = maxPages * budget.charsPerPage
  if (markdownUnits(markdown, budget) <= maxUnits) return { head: markdown, rest: null }
  const blocks = markdownBlocks(markdown)
  const head: string[] = []
  let used = 0
  let index = 0
  for (; index < blocks.length; index++) {
    const units = markdownUnits(blocks[index], budget)
    if (used + units > maxUnits) break
    head.push(blocks[index])
    used += units
  }
  if (head.length === 0 && blocks.length > 0) {
    const split = splitLongBlock(blocks[0], maxUnits)
    if (split) return { head: split[0], rest: [split[1], ...blocks.slice(1)].join('\n\n') }
    head.push(blocks[0])
    index = 1
  }
  const rest = blocks.slice(index)
  return { head: head.join('\n\n'), rest: rest.length ? rest.join('\n\n') : null }
}
