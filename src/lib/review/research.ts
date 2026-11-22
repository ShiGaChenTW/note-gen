// Fork（almanac ALMNC-54.13）：G1 研究員調研——定期讀各領域，拆成調研題目，查外部資料；結果交給指揮官統整成提案（R6）。
// 研究員不直接寫入筆記庫。模型與外部查詢都注入；沒有可用的查詢工具時題目照樣列出，標成「沒辦法查」。
import { extractJson } from '@/lib/collect/split'
import type { ExternalEvidence } from '@/lib/cleanup/types'

export type AskModel = (prompt: string) => Promise<string>

/** 給 G1、G2 看的一個領域：只有標題、摘要、狀態、最後確認日期（不是整份筆記庫）。 */
export interface DomainDigest {
  domainId: string
  name: string
  notes: Array<{ path: string, title: string, summary?: string, status?: string, lastConfirmed?: string }>
}

export interface ResearchFinding {
  domainId: string
  question: string
  /** found：查到並整理了；nothing：查了沒有新東西；unavailable：沒有可用的查詢工具；failed：查詢或整理失敗。 */
  status: 'found' | 'nothing' | 'unavailable' | 'failed'
  summary: string
  sources: Array<{ title: string, url: string }>
  /** 題目從哪幾則筆記來。 */
  notePaths: string[]
}

export interface ResearchDeps {
  ask: AskModel
  /** 研究員的工作指示＋個別記憶。 */
  prompt?: string
  /** 外部查詢（既有的網路搜尋）。沒有就是 unavailable。 */
  lookup?: (query: string) => Promise<ExternalEvidence[]>
  maxQuestions?: number
}

function digestText(digest: DomainDigest): string {
  return digest.notes.slice(0, 40).map((note, index) => `[${index}] ${note.title}${note.summary ? ` — ${note.summary}` : ''}${note.status && note.status !== 'valid' ? ` (${note.status})` : ''}${note.lastConfirmed ? ` [confirmed ${note.lastConfirmed}]` : ''}`).join('\n')
}

export function buildQuestionPrompt(digest: DomainDigest, max: number): string {
  return [
    `You are the researcher. Read the notes of the domain "${digest.name}" and propose at most ${max} research questions worth checking against external sources: claims that may be outdated, disputed notes, gaps between notes.`,
    'Each question is one web search query. Use the language of the notes.',
    'Output JSON only: {"questions":[{"question":"","notes":[0]}]}',
    '---',
    digestText(digest),
  ].join('\n')
}

export function parseQuestions(raw: string, digest: DomainDigest, max: number): Array<{ question: string, notePaths: string[] }> {
  const parsed = extractJson(raw)
  const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown } | null)?.questions
  if (!Array.isArray(list)) return []
  const out: Array<{ question: string, notePaths: string[] }> = []
  for (const item of list) {
    const record: Record<string, unknown> = item && typeof item === 'object' ? item as Record<string, unknown> : { question: item }
    const question = typeof record.question === 'string' ? record.question.trim() : ''
    if (!question || out.some(entry => entry.question === question)) continue
    const notePaths = (Array.isArray(record.notes) ? record.notes : []).map(Number)
      .filter((index: number) => Number.isInteger(index) && index >= 0 && index < digest.notes.length).map((index: number) => digest.notes[index].path)
    out.push({ question: Array.from(question).slice(0, 200).join(''), notePaths })
    if (out.length >= max) break
  }
  return out
}

export function buildSummaryPrompt(digest: DomainDigest, results: Array<{ question: string, evidence: ExternalEvidence[] }>): string {
  return [
    `Summarise what the external results add to the domain "${digest.name}". For each question: 1–3 sentences, cite nothing that is not in the results; say "nothing new" when they add nothing.`,
    'Output JSON only: {"findings":[{"index":0,"summary":"","nothingNew":false}]}',
    '---',
    ...results.map((result, index) => [`### (${index}) ${result.question}`, ...result.evidence.map(item => `- ${item.title} <${item.url}>: ${item.snippet}`)].join('\n')),
  ].join('\n')
}

/** 對每個領域：拆題目 → 查外部資料 → 整理成發現。某個領域失敗不影響其他的。 */
export async function researchDomains(digests: readonly DomainDigest[], deps: ResearchDeps): Promise<ResearchFinding[]> {
  const max = deps.maxQuestions ?? 3
  const findings: ResearchFinding[] = []
  for (const digest of digests) {
    if (!digest.notes.length) continue
    let questions: Array<{ question: string, notePaths: string[] }> = []
    try {
      questions = parseQuestions(await deps.ask([deps.prompt, buildQuestionPrompt(digest, max)].filter(Boolean).join('\n\n')), digest, max)
    } catch (error) {
      console.warn('[review] research questions failed:', error)
      continue
    }
    if (!questions.length) continue
    if (!deps.lookup) {
      // TODO（ALMNC-54.13）：App 沒開網路搜尋時，研究員只能列題目；之後接上其他查詢工具（例如 MCP）。
      for (const entry of questions) findings.push({ domainId: digest.domainId, question: entry.question, status: 'unavailable', summary: '', sources: [], notePaths: entry.notePaths })
      continue
    }
    const results: Array<{ question: string, notePaths: string[], evidence: ExternalEvidence[], failed: boolean }> = []
    for (const entry of questions) {
      try {
        results.push({ ...entry, evidence: (await deps.lookup(entry.question)).slice(0, 5), failed: false })
      } catch {
        results.push({ ...entry, evidence: [], failed: true })
      }
    }
    const withEvidence = results.filter(result => result.evidence.length)
    let summaries = new Map<number, { summary: string, nothingNew: boolean }>()
    if (withEvidence.length) {
      try {
        const parsed = extractJson(await deps.ask(buildSummaryPrompt(digest, withEvidence)))
        const list = (parsed as { findings?: unknown } | null)?.findings
        if (Array.isArray(list)) {
          summaries = new Map(list.flatMap(item => {
            const record = item as Record<string, unknown>
            const index = Number(record?.index)
            return Number.isInteger(index) && typeof record.summary === 'string' ? [[index, { summary: record.summary.trim(), nothingNew: record.nothingNew === true }]] : []
          }))
        }
      } catch (error) {
        console.warn('[review] research summary failed:', error)
      }
    }
    for (const result of results) {
      const index = withEvidence.indexOf(result)
      const summary = index >= 0 ? summaries.get(index) : undefined
      const sources = result.evidence.map(item => ({ title: item.title, url: item.url }))
      const status: ResearchFinding['status'] = result.failed ? 'failed'
        : !result.evidence.length || summary?.nothingNew ? 'nothing'
          : summary?.summary ? 'found' : 'failed'
      findings.push({ domainId: digest.domainId, question: result.question, status, summary: summary?.summary ?? '', sources, notePaths: result.notePaths })
    }
  }
  return findings
}
