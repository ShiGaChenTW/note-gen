// Fork（#34）：單篇筆記的行為訊號——自己寫了多少、摘抄多少、有沒有結構、總結、心得。純函式。
// 規格 personal/specs/11 §3.2；權重在 mastery.ts。
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'

export interface NoteAnalysis {
  /** 自己寫的字數（中日韓一字一單位、其他語言一詞一單位） */
  ownWords: number
  /** 引文、摘抄的字數（`>` 引用、網頁剪藏的正文） */
  quotedWords: number
  headings: number
  listItems: number
  /** 有「總結／結論／重點」段落且有內容 */
  hasSummary: boolean
  /** 有「心得／我的看法／反思」段落且有內容 */
  hasReflection: boolean
  /** 網頁剪藏（frontmatter 有來源網址或 clippings 標籤） */
  clipped: boolean
}

const SUMMARY_RE = /總結|总结|結論|结论|重點|重点|摘要|小結|小结|tl;?dr|summary|conclusion|takeaways?|key points|まとめ|要約|zusammenfassung|fazit|resumo|conclusão/i
const REFLECTION_RE = /心得|感想|我的(看法|想法|理解|觀點|观点|思考)|反思|想法|思考|啟發|启发|reflection|my (take|thoughts|view)|insights?|thoughts|感想|考察|気づき|gedanken|reflexion|reflexão|minhas ideias/i
/** 一個段落至少要有這麼多字，才算「有總結／有心得」。 */
const SECTION_MIN_WORDS = 20

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const WORD_RE = /[\p{L}\p{N}]+/gu

export function countWords(text: string): number {
  const cjk = text.match(CJK_RE)?.length ?? 0
  const rest = text.replace(CJK_RE, ' ')
  return cjk + (rest.match(WORD_RE)?.length ?? 0)
}

/** 去掉不算字的 Markdown：嵌入、網址、連結語法（留顯示文字）、標記符號。 */
function plainText(line: string): string {
  return line
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(^|\s)#[^\s#]+/g, ' ')
    .replace(/\^[\w-]+\s*$/, ' ')
}

function isClipped(frontmatter: Record<string, unknown> | null): boolean {
  if (!frontmatter) return false
  const tags = frontmatter.tags
  const tagList = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[\s,]+/) : []
  if (tagList.some(tag => /^#?clippings?$/i.test(String(tag)))) return true
  for (const key of ['source', 'url', 'link']) {
    const value = frontmatter[key]
    if (typeof value === 'string' && /^https?:\/\//.test(value.trim())) return true
  }
  return false
}

type Section = 'plain' | 'summary' | 'reflection'

export function analyzeNote(content: string, frontmatter: Record<string, unknown> | null): NoteAnalysis {
  const { body } = splitFrontmatter(content)
  const clipped = isClipped(frontmatter)
  const result: NoteAnalysis = { ownWords: 0, quotedWords: 0, headings: 0, listItems: 0, hasSummary: false, hasReflection: false, clipped }
  let fence: string | null = null
  let section: Section = 'plain'
  let sectionWords = 0
  /** 引用區塊是不是自己寫的 callout（[!note] 之類），[!quote] 與一般 `>` 算摘抄 */
  let calloutOwn = false
  const closeSection = () => {
    if (sectionWords >= SECTION_MIN_WORDS) {
      if (section === 'summary') result.hasSummary = true
      if (section === 'reflection') result.hasReflection = true
    }
    sectionWords = 0
  }
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const fenceMatch = raw.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue
    const heading = raw.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeSection()
      result.headings++
      const text = heading[2]
      section = REFLECTION_RE.test(text) ? 'reflection' : SUMMARY_RE.test(text) ? 'summary' : 'plain'
      continue
    }
    const quote = raw.match(/^\s*>\s?(.*)$/)
    let text = raw
    let own = !clipped || section !== 'plain'
    if (quote) {
      const callout = quote[1].match(/^\[!(\w+)\][-+]?\s*(.*)$/)
      if (callout) {
        calloutOwn = !/^(quote|cite)$/i.test(callout[1])
        text = callout[2]
      } else {
        text = quote[1]
      }
      own = own && calloutOwn
    } else {
      calloutOwn = false
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(text)) result.listItems++
    const words = countWords(plainText(text.replace(/^\s*(?:[-*+]|\d+[.)])\s+(\[.\]\s+)?/, '')))
    if (words === 0) continue
    if (own) result.ownWords += words
    else result.quotedWords += words
    if (section !== 'plain' && own) sectionWords += words
  }
  closeSection()
  return result
}

export interface SummaryCounts {
  myViews: number
  aiPoints: number
}

const NONE_ITEM_RE = /^[（(]?\s*(無|无|none|なし|keine|nenhum|n\/a)\s*[)）]?$/i

/**
 * 對話摘要（#33 renderSummary 的格式）各節條數。節標題會依語系翻譯，所以按順序取：
 * 第 2 個 `##` 是「我的觀點與理解」，第 3 個是「AI 的解答重點」。「（無）」不算。
 */
export function analyzeSummary(content: string): SummaryCounts {
  const counts: SummaryCounts = { myViews: 0, aiPoints: 0 }
  let section = 0
  for (const line of splitFrontmatter(content).body.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^##\s/.test(line)) {
      section++
      continue
    }
    const item = line.match(/^\s*[-*]\s+(.*)$/)
    if (!item || NONE_ITEM_RE.test(item[1].trim())) continue
    if (section === 2) counts.myViews++
    else if (section === 3) counts.aiPoints++
  }
  return counts
}

/** 對話摘要「我的觀點與理解」（第 2 個 `##`）各條的文字，給報告評語參考。 */
export function summaryViews(content: string): string[] {
  const out: string[] = []
  let section = 0
  for (const line of splitFrontmatter(content).body.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^##\s/.test(line)) {
      section++
      continue
    }
    const item = section === 2 && line.match(/^\s*[-*]\s+(.*)$/)
    if (item && !NONE_ITEM_RE.test(item[1].trim())) out.push(item[1].trim())
  }
  return out
}
