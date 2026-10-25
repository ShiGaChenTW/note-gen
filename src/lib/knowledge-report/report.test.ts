import { describe, expect, it } from 'vitest'
import { indexNote, parseFrontmatterData } from '@/lib/vault-index/index-note'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { vaultStats } from './aggregate'
import { normalizeReportSettings } from './generate'
import {
  carrySuggestion,
  estimateTokens,
  gapText,
  isReportDue,
  latestReport,
  openSuggestions,
  parseTopicReview,
  periodKey,
  pickExcerpts,
  quoteForBody,
  renderReport,
  reportFromFrontmatter,
  reportPath,
  settleSuggestions,
  topicsByChange,
  updateSuggestionInNote,
  type ReportData,
  type ReportTexts,
} from './report'

const texts: ReportTexts = {
  title: '{period} 知識報告',
  levels: { contact: '接觸', organized: '整理', internalized: '內化', integrated: '融會' },
  headings: { topics: '各主題掌握度', suggestions: '優化建議', stats: '統計' },
  previous: '上期 {level}',
  firstTime: '第一期',
  scoreLine: '{score} 分 · {notes} 篇',
  gapLabel: '還差：',
  topLevel: '已是最高級',
  noComment: '（沒有評語）',
  noSuggestions: '（無）',
  stats: { notes: '筆記', unlinked: '缺少連結', orphans: '孤立筆記', inbox: 'Inbox 積壓' },
  footer: '報告不會修改其他筆記',
}

function data(partial: Partial<ReportData> = {}): ReportData {
  return {
    period: '2026-W44',
    generated: '2026-10-26T13:00:00.000Z',
    model: 'gpt',
    tokens: 1234,
    topics: [
      { name: 'Rust', level: 'internalized', score: 63, notes: 41, prevLevel: 'organized', prevScore: 45, gap: '跨主題連結 0／3', comment: '開始有自己的觀點。', evidence: [{ quote: '借用檢查其實是編譯期證明', path: 'Rust/所有權.md' }] },
      { name: 'Tauri', level: 'contact', score: 20, notes: 12, prevLevel: null, prevScore: null, gap: '', comment: '', evidence: [] },
    ],
    suggestions: [
      { id: 'W44-1', topic: 'Rust', text: '補上和 Tauri 的連結', prompt: '在 [[Rust/所有權]] 補連結', status: 'open' },
      { id: 'W44-2', topic: 'Tauri', text: '用自己的話寫 IPC', prompt: '寫一篇', status: 'handed', task: 'task-1' },
    ],
    stats: { notes: 100, unlinked: 8, orphans: 3, inbox: 5 },
    ...partial,
  }
}

describe('期別與到期', () => {
  const monday = new Date(2026, 9, 26, 9)
  it('每日、每週、每月的期別與路徑', () => {
    expect(periodKey(monday, 'daily')).toBe('2026-10-26')
    expect(periodKey(monday, 'weekly')).toBe('2026-W44')
    expect(periodKey(monday, 'monthly')).toBe('2026-10')
    expect(reportPath('2026-W44')).toBe('報告/2026-W44 知識報告.md')
  })

  it('沒有基準就不自動產生；同一期已產生就不到期', () => {
    expect(isReportDue(null, monday, 'weekly')).toBe(false)
    expect(isReportDue(data({ period: '2026-W43' }), monday, 'weekly')).toBe(true)
    expect(isReportDue(data(), monday, 'weekly')).toBe(false)
    expect(isReportDue(data(), monday, 'daily')).toBe(true)
  })

  it('設定讀回：不認得的值用預設', () => {
    expect(normalizeReportSettings({ frequency: 'yearly', tokenLimit: 5, remindSuggestions: false })).toEqual({ frequency: 'weekly', tokenLimit: 200_000, remindSuggestions: false })
    expect(normalizeReportSettings(null).frequency).toBe('weekly')
  })
})

describe('送給模型的內容', () => {
  it('變動的筆記優先、再看自己寫的字；截斷並去掉 frontmatter', () => {
    const excerpts = pickExcerpts([
      { path: 'a.md', content: '---\nx: 1\n---\n舊的', changed: false, ownWords: 999 },
      { path: 'b.md', content: '新的很長的內容', changed: true, ownWords: 1 },
    ], 2, 3)
    expect(excerpts).toEqual([{ path: 'b.md', text: '新的很…' }, { path: 'a.md', text: '舊的' }])
  })

  it('token 估算：中文一字一 token、其他四字元一 token', () => {
    expect(estimateTokens('借用檢查')).toBe(4)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('缺口文字：OR 的一組用「或」，分數不夠時補上', () => {
    const labels = { notes: '筆記數', structure: '結構', internalLinks: '連結', ownRatio: '比例', ownViews: '觀點', revisedNotes: '改寫', crossLinks: '跨主題', applied: '用過', spanDays: '天數' }
    const gaps = [{ options: [{ metric: 'crossLinks' as const, have: 0, need: 3 }, { metric: 'applied' as const, have: 1, need: 2 }] }, { options: [{ metric: 'spanDays' as const, have: 5, need: 14 }] }]
    expect(gapText(gaps, labels, '或', 4, '還差 {points} 分')).toBe('跨主題 0／3 或 用過 1／2、天數 5／14、還差 4 分')
    expect(gapText([], labels, '或', 0, '')).toBe('')
  })
})

describe('解析模型回傳', () => {
  const contents = new Map([['Rust/所有權.md', '我覺得\n借用檢查其實是 編譯期證明，不是鎖。']])

  it('只留真的出現在筆記裡的引文（空白差異不算）', () => {
    const raw = '```json\n' + JSON.stringify({
      comment: '開始有自己的觀點。',
      evidence: [
        { quote: '「借用檢查其實是 編譯期證明」', path: 'Rust/所有權.md' },
        { quote: '我沒寫過這句', path: 'Rust/所有權.md' },
        { quote: '借用檢查', path: '不在摘錄.md' },
        { quote: '不是鎖。', path: 'Rust/所有權.md' },
      ],
      suggestions: [{ text: '補連結', prompt: '在 [[Rust/所有權]] 補連結' }, { text: '寫心得' }, { text: '' }],
    }) + '\n```'
    expect(parseTopicReview(raw, contents)).toEqual({
      comment: '開始有自己的觀點。',
      evidence: [{ quote: '借用檢查其實是 編譯期證明', path: 'Rust/所有權.md' }],
      suggestions: [{ text: '補連結', prompt: '在 [[Rust/所有權]] 補連結' }, { text: '寫心得', prompt: '寫心得' }],
    })
  })

  it('沒有評語或格式壞掉就失敗', () => {
    expect(parseTopicReview('{"comment":""}', contents)).toBeNull()
    expect(parseTopicReview('壞掉', contents)).toBeNull()
  })
})

describe('報告筆記', () => {
  it('輸出後從 frontmatter 讀回相同的資料；內文有等級變化、證據雙鏈與統計', () => {
    const md = renderReport(data(), texts)
    const fm = parseFrontmatterData(splitFrontmatter(md).block)
    expect(reportFromFrontmatter(fm)).toEqual(data())
    expect(md).toContain('# 2026-W44 知識報告')
    expect(md).toContain('**內化**（上期 整理）· 63 分 · 41 篇')
    expect(md).toContain('> 「借用檢查其實是編譯期證明」— [[Rust/所有權]]')
    expect(md).toContain('還差：已是最高級')
    expect(md).toContain('- 〔Rust〕補上和 Tauri 的連結')
    expect(md).toContain('- 缺少連結：8')
    // 建議不用 `- [ ]`，免得被當成待辦收進首頁
    expect(md).not.toMatch(/- \[ \]/)
  })

  it('內文的引文壓成一行，任務、雙鏈、標籤都中和掉', () => {
    expect(quoteForBody('- [ ] 未完成的任務 📅 2026-10-19\n- [x] 已完成\n看 [[Note|顯示]] 與 ![[圖]] #專案/alpha，C# 與 &#123; 不動')).toBe('未完成的任務 📅 2026-10-19 已完成 看 顯示 與 圖 ＃專案/alpha，C# 與 &#123; 不動')
    const md = renderReport(data({ topics: [{ ...data().topics[0], evidence: [{ quote: '- [ ] 待辦\n#標籤 [[連結]]', path: 'a.md' }] }] }), texts)
    const body = splitFrontmatter(md).body
    const indexed = indexNote('報告/x.md', `---\n---\n${body}`, 0)
    expect(indexed.tasks).toEqual([])
    expect(indexed.tags).toEqual([])
    expect(indexed.links.map(link => link.target)).toEqual(['a'])
  })

  it('不是報告就讀不到；最新一期依產出時間', () => {
    expect(reportFromFrontmatter({ type: '對話摘要', period: 'x' })).toBeNull()
    const older = { path: 'a', report: data({ generated: '2026-10-19T00:00:00Z' }) }
    const newer = { path: 'b', report: data() }
    expect(latestReport([newer, older])?.path).toBe('b')
    expect(latestReport([])).toBeNull()
  })

  it('改建議狀態只動 frontmatter，內文不變', () => {
    const md = renderReport(data(), texts)
    const next = updateSuggestionInNote(md, 'W44-1', { status: 'handed', task: 'task-9' })!
    expect(splitFrontmatter(next).body).toBe(splitFrontmatter(md).body)
    const report = reportFromFrontmatter(parseFrontmatterData(splitFrontmatter(next).block))!
    expect(report.suggestions[0]).toMatchObject({ status: 'handed', task: 'task-9' })
    expect(updateSuggestionInNote(md, 'nope', { status: 'done' })).toBeNull()
    expect(updateSuggestionInNote('沒有 frontmatter', 'W44-1', { status: 'done' })).toBeNull()
  })

  it('交給 Agent 的任務完成後算已處理；未處理清單；變化大的主題在前', () => {
    const report = data()
    expect(settleSuggestions(report, id => (id === 'task-1' ? 'completed' : undefined))).toEqual([{ id: 'W44-2', status: 'done' }])
    expect(settleSuggestions(report, () => 'running')).toEqual([])
    expect(openSuggestions(report).map(item => item.id)).toEqual(['W44-1'])
    expect(openSuggestions(null)).toEqual([])
    expect(topicsByChange(report).map(topic => topic.name)).toEqual(['Rust', 'Tauri'])
  })
})

describe('建議狀態沿用', () => {
  const item = { topic: 'Tauri', text: '用自己的話寫 IPC', prompt: 'p' }
  it('同一期重新產生：沿用 id 與狀態；新的一期：沿用上一期的狀態但用新 id；沒有相同的就是 open', () => {
    expect(carrySuggestion(item, 'new-1', data(), null)).toEqual({ id: 'W44-2', ...item, status: 'handed', task: 'task-1' })
    expect(carrySuggestion(item, '2026-W45-1', null, data())).toEqual({ id: '2026-W45-1', ...item, status: 'handed', task: 'task-1' })
    expect(carrySuggestion({ ...item, text: '別的' }, 'x', data(), data())).toEqual({ id: 'x', ...item, text: '別的', status: 'open' })
  })
})

describe('知識庫健康', () => {
  it('缺少連結、孤立、Inbox；排除資料夾、每日筆記、報告不算', () => {
    const notes = [
      indexNote('a.md', '[[b]]', 0),
      indexNote('b.md', '沒有連出', 0),
      indexNote('c.md', '孤立', 0),
      indexNote('Inbox/x.md', '收件', 0),
      indexNote('私人/y.md', '排除', 0),
      indexNote('20 Journal/21 Daily/20261026.md', '[[c]]', 0),
      indexNote('報告/2026-W44 知識報告.md', '[[c]]', 0),
    ]
    expect(vaultStats({ notes, daily: { folder: '20 Journal/21 Daily', pattern: 'YYYYMMDD' }, excludeFolders: ['私人'] }, 'Inbox')).toEqual({
      notes: 4,
      unlinked: 3,
      // c.md 有每日筆記連進來，所以不算孤立；報告連進來不算
      orphans: 1,
      inbox: 1,
    })
  })
})
