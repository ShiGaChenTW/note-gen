// Fork（almanac ALMNC-54.21 AC#4）：新增筆記的提案——接受前在卡片上改標題與存放位置，接受時用改過的值。
import { describe, expect, it } from 'vitest'
import type { Proposal } from '@/lib/collect/types'
import { checkNewNoteEdit, newNoteChanges, newNoteChangesNote, newNoteTarget, normalizeFolder, retargetNewNote } from './new-note'

const INBOX = '00 Inbox'
const note: Proposal = { id: 'p1', kind: 'note', title: '會議紀錄', body: '內文', due: '', time: '', tags: [] }
const create: Proposal = {
  ...note, title: '新增 OEE 的定義',
  change: { toolName: 'note_create_file', args: { folderPath: '知識', fileName: 'OEE.md', content: '# OEE' }, kind: 'create', path: '知識/OEE.md', content: '# OEE', baseContent: null, summary: '新增 OEE 的定義' },
}

describe('new note proposals', () => {
  it('shows the suggested title and folder (inbox by default; the file path for a commander create)', () => {
    expect(newNoteTarget(note, INBOX)).toEqual({ title: '會議紀錄', folder: '00 Inbox' })
    expect(newNoteTarget({ ...note, folder: '' }, INBOX)).toEqual({ title: '會議紀錄', folder: '' })
    expect(newNoteTarget(create, INBOX)).toEqual({ title: 'OEE', folder: '知識' })
  })

  it('only applies to new notes — not tasks, updates, cleanup edits or slots', () => {
    expect(newNoteTarget({ ...note, kind: 'task' }, INBOX)).toBeNull()
    expect(newNoteTarget({ ...create, change: { ...create.change!, kind: 'update', toolName: 'note_update_file' } }, INBOX)).toBeNull()
    expect(newNoteTarget({ ...note, edits: [{ path: 'a.md', content: 'x', baseContent: '' }] } as Proposal, INBOX)).toBeNull()
  })

  it('retargets a collected note: edited title and folder are what gets written', () => {
    const next = retargetNewNote(note, { title: ' 產線檢討 會議紀錄 ', folder: '/10 Projects//產線/' }, INBOX)
    expect(next).toMatchObject({ title: '產線檢討 會議紀錄', folder: '10 Projects/產線', body: '內文' })
    // 只改標題時不記 folder（接受時照當下的收件資料夾）
    expect('folder' in retargetNewNote(note, { title: '新標題', folder: INBOX }, INBOX)).toBe(false)
    expect(retargetNewNote(note, { title: '會議紀錄', folder: INBOX }, INBOX)).toBe(note)
  })

  it('retargets a commander create: tool arguments and path follow the edit, the extension is kept', () => {
    const next = retargetNewNote(create, { title: 'OEE 的定義', folder: '知識/工業工程' }, INBOX)
    expect(next.change).toMatchObject({ path: '知識/工業工程/OEE 的定義.md', args: { folderPath: '知識/工業工程', fileName: 'OEE 的定義.md', content: '# OEE' } })
    expect(next.title).toBe('新增 OEE 的定義')
    expect(retargetNewNote(create, { title: 'v1.2 規劃', folder: '' }, INBOX).change).toMatchObject({ path: 'v1.2 規劃.md', args: { folderPath: '' } })
  })

  it('refuses an empty title, a title with slashes and a folder that climbs out of the vault', () => {
    expect(checkNewNoteEdit({ title: '  ', folder: '' })).toEqual({ ok: false, error: 'TITLE_REQUIRED' })
    expect(checkNewNoteEdit({ title: 'a/b', folder: '' })).toEqual({ ok: false, error: 'TITLE_INVALID' })
    expect(checkNewNoteEdit({ title: 'a', folder: '知識/../..' })).toEqual({ ok: false, error: 'FOLDER_INVALID' })
    expect(retargetNewNote(note, { title: 'a/b', folder: 'x' }, INBOX)).toBe(note)
    expect(normalizeFolder(' . ')).toBe('')
  })

  // Fork（almanac ALMNC-69.2）：Scott 改了標題或位置，保留原建議並說明差異。
  it('records the original suggestion on the first edit and never overwrites it', () => {
    const once = retargetNewNote(note, { title: '產線會議', folder: INBOX }, INBOX)
    expect(once.suggested).toEqual({ title: '會議紀錄' })
    const twice = retargetNewNote(once, { title: '產線週會', folder: '10 Projects' }, INBOX)
    expect(twice.suggested).toEqual({ title: '會議紀錄' })
    const created = retargetNewNote(create, { title: 'OEE 的定義', folder: '知識' }, INBOX)
    expect(created.suggested).toEqual({ title: 'OEE', folder: '知識' })
    // 一開始就指定了位置（含最上層）也照記
    expect(retargetNewNote({ ...note, folder: '' }, { title: '新', folder: '' }, INBOX).suggested).toEqual({ title: '會議紀錄', folder: '' })
  })

  it('explains the difference between the suggestion and the edit, before and after accepting', () => {
    expect(newNoteChanges(note, INBOX)).toBeNull()
    const edited = retargetNewNote(note, { title: '產線週會', folder: '10 Projects' }, INBOX)
    const changes = newNoteChanges(edited, INBOX)
    expect(changes).toEqual({ title: '產線週會', titleChange: { from: '會議紀錄', to: '產線週會' }, folderChange: { from: INBOX, to: '10 Projects' } })
    expect(newNoteChanges({ ...edited, status: 'ok' } as Proposal, INBOX)).toEqual(changes)
    expect(newNoteChangesNote(changes!)).toBe('會議紀錄 → 產線週會 · 00 Inbox/ → 10 Projects/')
    // 只改位置：主語是標題，最上層寫「/」
    const moved = newNoteChanges(retargetNewNote(note, { title: '會議紀錄', folder: '' }, INBOX), INBOX)!
    expect(moved.titleChange).toBeUndefined()
    expect(newNoteChangesNote(moved)).toBe('會議紀錄 · 00 Inbox/ → /')
    // 改回原樣就沒有差異
    expect(newNoteChanges(retargetNewNote(edited, { title: '會議紀錄', folder: INBOX }, INBOX), INBOX)).toBeNull()
    const createdChanges = newNoteChanges(retargetNewNote(create, { title: 'OEE 的定義', folder: '知識' }, INBOX), INBOX)
    expect(createdChanges).toEqual({ title: 'OEE 的定義', titleChange: { from: 'OEE', to: 'OEE 的定義' } })
  })
})
