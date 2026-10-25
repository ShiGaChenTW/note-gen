import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import type { Chat } from '@/db/chats'
import {
  buildTranscript,
  collectReferencedPaths,
  conversationKey,
  findExistingSummary,
  parseSummaryJson,
  renderSummary,
  resolveRelated,
  summarizedConversations,
  summaryPath,
} from './model'

function chat(partial: Partial<Chat>): Chat {
  return { id: 1, role: 'user', type: 'chat', inserted: false, createdAt: 0, content: '', ...partial }
}

const headings = { myQuestions: '我的問題', myViews: '我的觀點與理解', aiPoints: 'AI 的解答重點', decisions: '結論與決定', openQuestions: '還沒解決的問題', related: '相關筆記', none: '（無）' }

describe('對話摘要', () => {
  it('路徑：對話摘要/YYYY/MM/YYYY-MM-DD 主旨.md', () => {
    const date = new Date(2026, 9, 26, 9, 0)
    expect(summaryPath(date, 'Rust 借用檢查為什麼擋我?')).toBe('對話摘要/2026/10/2026-10-26 Rust 借用檢查為什麼擋我.md')
    expect(summaryPath(date, '  ')).toBe('對話摘要/2026/10/2026-10-26.md')
  })

  it('對話識別優先用 syncId', () => {
    expect(conversationKey({ id: 7, syncId: 'abc' })).toBe('abc')
    expect(conversationKey({ id: 7 })).toBe('7')
  })

  it('逐字稿分開標記我與 AI，略過非對話訊息，過長保留後段', () => {
    const chats = [
      chat({ role: 'user', content: '為什麼借用檢查擋我？' }),
      chat({ role: 'system', content: '因為同時有可變與不可變參考。' }),
      chat({ role: 'system', type: 'clear', content: 'x' }),
      chat({ role: 'user', content: '  ' }),
    ]
    expect(buildTranscript(chats)).toBe('【我】\n為什麼借用檢查擋我？\n\n【AI】\n因為同時有可變與不可變參考。')
    expect(buildTranscript(chats, undefined, 10)).toHaveLength(10)
  })

  it('從 RAG 來源與 Agent 紀錄找出提到的筆記', () => {
    const chats = [
      chat({ ragSourceDetails: JSON.stringify([{ filepath: 'Rust/所有權.md', content: 'x' }]) }),
      chat({ agentHistory: JSON.stringify({ steps: [{ action: { params: { filePath: '/Rust/借用.md' } } }] }), quoteData: 'not json' }),
    ]
    expect(collectReferencedPaths(chats)).toEqual(['Rust/所有權.md', 'Rust/借用.md'])
  })

  it('解析模型回傳（含 ```json 包裝），缺主旨就失敗', () => {
    const raw = '```json\n{"subject":"借用檢查","myViews":["我以為是執行期鎖"],"aiPoints":["編譯期規則"],"topics":["Rust"],"related":["所有權"],"extra":1}\n```'
    expect(parseSummaryJson(raw)).toEqual({ subject: '借用檢查', myQuestions: [], myViews: ['我以為是執行期鎖'], aiPoints: ['編譯期規則'], decisions: [], openQuestions: [], topics: ['Rust'], related: ['所有權'] })
    expect(parseSummaryJson('{"myViews":[]}')).toBeNull()
    expect(parseSummaryJson('not json')).toBeNull()
  })

  it('相關筆記：實際用到的優先，再加上 vault 裡找得到的提及', () => {
    const paths = ['Rust/所有權.md', 'Rust/借用.md', 'Tauri/IPC.md']
    expect(resolveRelated(['rust/所有權.md'], ['[[借用]]', 'Rust/所有權', '不存在'], paths)).toEqual(['Rust/所有權.md', 'Rust/借用.md'])
  })

  it('輸出：YAML frontmatter、固定分節、雙鏈、空節標示', () => {
    const md = renderSummary(
      { subject: '借用檢查', myQuestions: ['為什麼擋我'], myViews: [], aiPoints: ['編譯期規則'], decisions: [], openQuestions: ['Rc 何時用'], topics: ['Rust'], related: [] },
      { conversation: 'abc', date: new Date(2026, 9, 26), related: ['Rust/所有權.md'] },
      headings,
    )
    const front = md.split('---')[1]
    expect(YAML.parse(front)).toEqual({ type: '對話摘要', conversation: 'abc', date: '2026-10-26', topics: ['Rust'] })
    expect(md).toContain('# 借用檢查')
    expect(md).toContain('## 我的觀點與理解\n\n- （無）')
    expect(md).toContain('## 相關筆記\n\n- [[Rust/所有權]]')
    expect(md.endsWith('\n')).toBe(true)
  })

  it('找既有摘要（同一對話再按一次就更新同一份）', () => {
    const notes = [
      { path: 'a.md', mtime: 1, frontmatter: { type: '對話摘要', conversation: 'abc' } },
      { path: 'b.md', mtime: 2, frontmatter: { type: '其他', conversation: 'xyz' } },
      { path: 'c.md', mtime: 3, frontmatter: { type: '對話摘要', conversation: 7 } },
    ]
    expect(findExistingSummary(notes, 'abc')).toEqual({ path: 'a.md', mtime: 1 })
    expect(findExistingSummary(notes, '7')).toEqual({ path: 'c.md', mtime: 3 })
    expect(findExistingSummary(notes, 'xyz')).toBeNull()
    expect([...summarizedConversations(notes).entries()]).toEqual([['abc', 1], ['7', 3]])
  })
})
