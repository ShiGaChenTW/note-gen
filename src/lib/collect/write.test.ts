// almanac ALMNC-8：收下提案寫進既有位置（筆記新檔、今日日誌捕捉軌），可復原。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()

vi.mock('@/lib/daily/note-io', () => ({
  noteExists: async (path: string) => files.has(path),
  readNote: async (path: string) => files.get(path) ?? null,
  writeNote: async (path: string, content: string) => { files.set(path, content) },
  revealInFileTree: async () => undefined,
}))

vi.mock('@/lib/daily/open-daily-note', () => ({
  ensureDailyNote: async (now: Date) => {
    const path = `20 Journal/21 Daily/${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.md`
    if (!files.has(path)) files.set(path, '# 今天\n\n## 捕捉軌\n\n- [ ] 既有任務\n')
    return { path }
  },
}))

const { acceptProposal, undoAccepted } = await import('./write')

const now = new Date(2026, 10, 18, 9, 30)
const base = { body: '', due: '', time: '', tags: [] as string[] }

describe('acceptProposal', () => {
  beforeEach(() => {
    files.clear()
  })

  it('ALMNC-69.3：只貼日誌標籤的卡不寫任何檔案', async () => {
    const result = await acceptProposal({ ...base, id: 'j1', kind: 'note', title: '11/03 下午', sourceIds: ['src_1'], journalTag: { confidence: 'high', only: true } }, { noteFolder: '10 Inbox', now })
    expect(result).toEqual({ path: '' })
    expect(files.size).toBe(0)
  })

  it('writes a note as a new file in the inbox folder', async () => {
    const result = await acceptProposal({ ...base, id: 'n1', kind: 'note', title: '定價想法', body: '三種收費模式並列', tags: ['idea'] }, { noteFolder: '10 Inbox', now })
    expect(result.path).toBe('10 Inbox/2026-11-18 0930 定價想法.md')
    expect(files.get(result.path)).toBe('# 定價想法\n\n三種收費模式並列\n\n#idea\n')
    expect(result.record).toBeUndefined()
  })

  // Fork（almanac ALMNC-54.21 AC#4）：卡片上改過的標題與存放位置就是寫入的檔名與資料夾。
  it('writes the note to the folder chosen on the card, with the edited title', async () => {
    const result = await acceptProposal({ ...base, id: 'n9', kind: 'note', title: '產線檢討會議紀錄', folder: '10 Projects/產線' }, { noteFolder: '10 Inbox', now })
    expect(result.path).toBe('10 Projects/產線/2026-11-18 0930 產線檢討會議紀錄.md')
    expect(files.get(result.path)).toBe('# 產線檢討會議紀錄\n')
    const root = await acceptProposal({ ...base, id: 'n10', kind: 'note', title: '放最上層', folder: '' }, { noteFolder: '10 Inbox', now })
    expect(root.path).toBe('2026-11-18 0930 放最上層.md')
  })

  it('does not overwrite an existing note with the same name', async () => {
    files.set('10 Inbox/2026-11-18 0930 定價想法.md', '舊內容')
    const result = await acceptProposal({ ...base, id: 'n2', kind: 'note', title: '定價想法' }, { noteFolder: '10 Inbox', now })
    expect(result.path).toBe('10 Inbox/2026-11-18 0930 定價想法 2.md')
    expect(files.get('10 Inbox/2026-11-18 0930 定價想法.md')).toBe('舊內容')
  })

  it('adds tasks and events to the capture section of today and can undo them', async () => {
    const task = await acceptProposal({ ...base, id: 't1', kind: 'task', title: '回覆 Mia' }, { noteFolder: '10 Inbox', now })
    const event = await acceptProposal({ ...base, id: 'e1', kind: 'event', title: '寫提案', time: '14:00' }, { noteFolder: '10 Inbox', now })
    expect(task.path).toBe(event.path)
    const daily = files.get(task.path) ?? ''
    expect(daily).toContain('- [ ] 回覆 Mia 📅 2026-11-18')
    expect(daily).toContain('- [ ] 寫提案 📅 2026-11-18 ⏰ 14:00')
    expect(daily.indexOf('## 捕捉軌')).toBeLessThan(daily.indexOf('回覆 Mia'))
    expect(daily).toContain('- [ ] 既有任務')

    expect(await undoAccepted(event)).toBe(true)
    expect(files.get(task.path)).not.toContain('寫提案')
    expect(files.get(task.path)).toContain('回覆 Mia')
  })

})

// Fork（almanac ALMNC-54.7）：檔案變更提案接受時才寫入（同背景任務的草稿審核）。
describe('acceptProposal with a file change', () => {
  it('applies the change only when accepted and reports the target path', async () => {
    const change = { toolName: 'note_move_file', args: { filePath: 'a.md', targetFolderPath: 'b' }, kind: 'move' as const, path: 'a.md', targetPath: 'b/a.md', baseContent: 'x', summary: '搬移 a.md → b/a.md' }
    const applied: unknown[] = []
    const result = await acceptProposal({ ...base, id: 'c1', kind: 'note', title: change.summary, change }, { noteFolder: '10 Inbox', now, applyChange: async value => { applied.push(value) } })
    expect(applied).toEqual([change])
    expect(result).toEqual({ path: 'b/a.md' })
  })

  // Fork（almanac ALMNC-54.12）：V3 筆記寫入時記下最後確認日期；清理提案走 applyEdits，不另外新增筆記。
  it('stamps lastConfirmed on V3 notes', async () => {
    const result = await acceptProposal({ ...base, id: 'v1', kind: 'note', title: '節拍時間', noteType: 'knowledge', domains: ['ie'] }, { noteFolder: '10 Inbox', now })
    expect(files.get(result.path)).toContain('lastConfirmed: 2026-11-18')
  })

  it('applies cleanup edits instead of creating a note', async () => {
    files.clear()
    const applyEdits = vi.fn(async () => ['k/a.md'])
    const proposal = { ...base, id: 'c1', kind: 'note' as const, title: '待查證：A', edits: [{ path: 'k/a.md', baseContent: 'A', content: 'A2', summary: 'A' }] }
    const result = await acceptProposal(proposal, { noteFolder: '10 Inbox', now, applyEdits })
    expect(applyEdits).toHaveBeenCalledWith(proposal)
    expect(result).toEqual({ path: 'k/a.md' })
    expect([...files.keys()]).toEqual([])
  })
})
