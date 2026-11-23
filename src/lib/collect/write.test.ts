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

// Fork（almanac ALMNC-69.1）：系統索引的假實作——記下登記的編號，可預先放入「已存在」的編號測撞號。
const indexed = new Map<string, { id: string, kind: string, path?: string }>()
const ids = {
  exists: (id: string) => indexed.has(id),
  record: async (input: { id: string, kind: string, path?: string }) => { indexed.set(input.id, input) },
}
vi.mock('@/db/id-index', () => ({ idExists: async (id: string) => ids.exists(id), recordId: ids.record }))

const { acceptProposal, undoAccepted } = await import('./write')

const ID = /^---\nid: N-20261118-\d{6}-[A-Z0-9]{4}\n/
/** 去掉 frontmatter 的 id 行（id 含隨機碼）。 */
function withoutId(content: string | undefined) {
  return (content ?? '').replace(/^---\nid: N-[^\n]+\n---\n/, '').replace(/^(---\n)id: N-[^\n]+\n/, '$1')
}

const now = new Date(2026, 10, 18, 9, 30)
const base = { body: '', due: '', time: '', tags: [] as string[] }

describe('acceptProposal', () => {
  beforeEach(() => {
    files.clear()
    indexed.clear()
  })

  it('ALMNC-69.3：只貼日誌標籤的卡不寫任何檔案', async () => {
    const result = await acceptProposal({ ...base, id: 'j1', kind: 'note', title: '11/03 下午', sourceIds: ['src_1'], journalTag: { confidence: 'high', only: true } }, { noteFolder: '10 Inbox', now })
    expect(result).toEqual({ path: '' })
    expect(files.size).toBe(0)
  })

  it('writes a note as a new file in the inbox folder', async () => {
    const result = await acceptProposal({ ...base, id: 'n1', kind: 'note', title: '定價想法', body: '三種收費模式並列', tags: ['idea'] }, { noteFolder: '10 Inbox', now })
    expect(result.path).toBe('10 Inbox/定價想法.md')
    expect(files.get(result.path)).toMatch(ID)
    expect(withoutId(files.get(result.path))).toBe('# 定價想法\n\n三種收費模式並列\n\n#idea\n')
    expect(result.record).toBeUndefined()
  })

  // Fork（almanac ALMNC-54.21 AC#4）：卡片上改過的標題與存放位置就是寫入的檔名與資料夾。
  it('writes the note to the folder chosen on the card, with the edited title', async () => {
    const result = await acceptProposal({ ...base, id: 'n9', kind: 'note', title: '產線檢討會議紀錄', folder: '10 Projects/產線' }, { noteFolder: '10 Inbox', now })
    expect(result.path).toBe('10 Projects/產線/產線檢討會議紀錄.md')
    expect(withoutId(files.get(result.path))).toBe('# 產線檢討會議紀錄\n')
    const root = await acceptProposal({ ...base, id: 'n10', kind: 'note', title: '放最上層', folder: '' }, { noteFolder: '10 Inbox', now })
    expect(root.path).toBe('放最上層.md')
  })

  it('does not overwrite an existing note with the same name', async () => {
    files.set('10 Inbox/定價想法.md', '舊內容')
    const result = await acceptProposal({ ...base, id: 'n2', kind: 'note', title: '定價想法' }, { noteFolder: '10 Inbox', now })
    expect(result.path).toBe('10 Inbox/定價想法 2.md')
    expect(files.get('10 Inbox/定價想法.md')).toBe('舊內容')
  })

  // Fork（almanac ALMNC-69.1 AC#1）：接受時產生 N 編號，寫在 frontmatter 第一行並登記到系統索引。
  it('gives the accepted note an N id in the first frontmatter line and records it in id_index', async () => {
    const result = await acceptProposal({ ...base, id: 'n3', kind: 'note', title: '節拍時間', noteType: 'knowledge', domains: ['ie'] }, { noteFolder: '10 Inbox', now, ids })
    const content = files.get(result.path) ?? ''
    expect(content).toMatch(ID)
    const id = content.match(/^---\nid: (\S+)/)?.[1] ?? ''
    expect(indexed.get(id)).toEqual({ id, kind: 'N', path: '10 Inbox/節拍時間.md' })
    expect(content).toContain('title: 節拍時間')
  })

  it('redraws the id when the short code is already taken', async () => {
    const stamp = `N-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}00`
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues')
    // 第一次抽到 AAAA（已被佔用），第二次抽到別的。
    for (let i = 0; i < 4; i++) random.mockImplementationOnce(buffer => { (buffer as Uint32Array)[0] = 0; return buffer })
    indexed.set(`${stamp}-AAAA`, { id: `${stamp}-AAAA`, kind: 'N' })
    const result = await acceptProposal({ ...base, id: 'n4', kind: 'note', title: '撞號' }, { noteFolder: '10 Inbox', now, ids })
    random.mockRestore()
    const id = files.get(result.path)?.match(/^---\nid: (\S+)/)?.[1]
    expect(id).toMatch(new RegExp(`^${stamp}-[A-Z0-9]{4}$`))
    expect(id).not.toBe(`${stamp}-AAAA`)
  })

  it('still writes the note when id_index recording fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await acceptProposal({ ...base, id: 'n5', kind: 'note', title: '索引壞了' }, { noteFolder: '10 Inbox', now, ids: { exists: () => false, record: async () => { throw new Error('db down') } } })
    expect(files.get(result.path)).toMatch(ID)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
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
