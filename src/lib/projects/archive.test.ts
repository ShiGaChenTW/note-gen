// Fork（almanac ALMNC-89）：結束專案＝封存專案筆記；知識筆記留在原領域。
import { describe, expect, it, vi } from 'vitest'
import type { SharedContext } from '@/lib/agent-memory/context'
import { parseV3Note } from '@/lib/v3-model/note'
import {
  archiveNoteRaw, archiveProject, archivedNames, contextWithoutProject, contextWithProject, findProjectNotes, isProjectArchived,
  listArchivedProjects, restoreNoteRaw, restoreProject, sanitizeArchivedProjects, type ProjectArchiveDeps, type ProjectNoteCandidate,
} from './archive'

const PROJECT = '---\nid: N-20261101-090000-abcd\ntype: project\ntitle: 電子紙\nstatus: valid\ntags: [ hardware ]\n---\n# 電子紙\n\n目標。\n'
const PROJECT_NO_STATUS = '---\ntype: project\n---\n# 搬家\n\n清單。\n'
const KNOWLEDGE = '---\ntype: knowledge\ntitle: 墨水屏刷新\ndomains: [D-hardware]\nproject: 電子紙\nrelated: ["[[電子紙]]"]\n---\n局部刷新會殘影。\n'

function candidate(path: string, frontmatter: Record<string, unknown> | null, h1?: string): ProjectNoteCandidate {
  return { path, frontmatter, headings: h1 ? [{ level: 1, text: h1 }] : [] }
}

function fakeVault(initial: Record<string, string>, context: SharedContext) {
  const files = new Map(Object.entries(initial))
  const state = { context }
  const deps: ProjectArchiveDeps = {
    now: () => 42,
    findProjectNotes: async name => findProjectNotes([...files.entries()].map(([path, raw]) => {
      const parsed = parseV3Note(raw)
      return candidate(path, { ...parsed.extra, ...(parsed.fields.type ? { type: parsed.fields.type } : {}), ...(parsed.fields.title ? { title: parsed.fields.title } : {}) },
        parsed.body.match(/^# (.+)$/m)?.[1])
    }), name),
    rewriteNote: vi.fn(async (path: string, rewrite: (raw: string) => string | null) => {
      const raw = files.get(path)
      if (raw === undefined) throw new Error(`missing ${path}`)
      const next = rewrite(raw)
      if (next === null || next === raw) return null
      files.set(path, next)
      return raw
    }),
    getContext: async () => state.context,
    saveContext: vi.fn(async (next: SharedContext) => { state.context = next }),
  }
  return { files, state, deps }
}

describe('projects/archive：找專案筆記', () => {
  it('只找 type: project 且標題等於專案名的；知識筆記寫了 project: 也不算', () => {
    const notes = [
      candidate('40 專案/電子紙.md', { type: 'project', title: '電子紙' }),
      candidate('40 專案/電子紙 v2.md', { type: 'project' }, ' 電子紙 '),
      candidate('40 專案/其他.md', { type: 'project', title: '搬家' }),
      candidate('知識/墨水屏.md', { type: 'knowledge', title: '電子紙', project: '電子紙' }),
      candidate('電子紙.md', null),
    ]
    expect(findProjectNotes(notes, '電子紙')).toEqual(['40 專案/電子紙 v2.md', '40 專案/電子紙.md'])
    // 沒有 title、也沒有 H1 時用檔名；比對不分大小寫
    expect(findProjectNotes([candidate('P/Alpha.md', { type: 'Project' })], 'alpha')).toEqual(['P/Alpha.md'])
    expect(findProjectNotes(notes, '  ')).toEqual([])
  })
})

describe('projects/archive：改寫單則筆記', () => {
  it('封存只改 status，其他欄位與內文保留；已經封存的不動', () => {
    const archived = archiveNoteRaw(PROJECT)!
    expect(parseV3Note(archived).fields).toMatchObject({ status: 'archived', type: 'project', title: '電子紙', tags: ['hardware'] })
    expect(archived).toContain('id: N-20261101-090000-abcd')
    expect(parseV3Note(archived).body).toBe(parseV3Note(PROJECT).body)
    expect(archiveNoteRaw(archived)).toBeNull()
    expect(archiveNoteRaw('---\nbad: [\n---\n')).toBeNull()
  })

  it('取消封存改回原本的狀態；原本沒填就拿掉；使用者已改過就不蓋掉', () => {
    expect(restoreNoteRaw(archiveNoteRaw(PROJECT)!, 'valid')).toBe(PROJECT)
    expect(restoreNoteRaw(archiveNoteRaw(PROJECT_NO_STATUS)!, null)).toBe(PROJECT_NO_STATUS)
    expect(restoreNoteRaw(PROJECT, null)).toBeNull()
  })
})

describe('projects/archive：目前脈絡', () => {
  it('拿掉同名專案，放回時不重複、不超過上限', () => {
    const base: SharedContext = { projects: [{ title: '電子紙', link: '[[電子紙]]' }, { title: '搬家' }], weeklyFocus: [{ title: 'x' }], people: ['Amy'] }
    const { context, removed } = contextWithoutProject(base, ' 電子紙 ')
    expect(context.projects).toEqual([{ title: '搬家' }])
    expect(context.weeklyFocus).toEqual(base.weeklyFocus)
    expect(removed).toEqual([{ title: '電子紙', link: '[[電子紙]]' }])
    expect(contextWithoutProject(base, '沒有').context).toBe(base)

    expect(contextWithProject(context, removed).projects).toEqual([{ title: '搬家' }, { title: '電子紙', link: '[[電子紙]]' }])
    expect(contextWithProject(base, removed)).toBe(base)
    const full: SharedContext = { projects: Array.from({ length: 10 }, (_, i) => ({ title: `P${i}` })), weeklyFocus: [], people: [] }
    expect(contextWithProject(full, removed)).toBe(full)
  })
})

describe('projects/archive：結束專案與取消封存', () => {
  it('結束專案：專案筆記封存（不刪除）、知識筆記不動、脈絡拿掉；取消封存照紀錄還原', async () => {
    const { files, state, deps } = fakeVault(
      { '40 專案/電子紙.md': PROJECT, '知識/墨水屏刷新.md': KNOWLEDGE, '40 專案/搬家.md': PROJECT_NO_STATUS },
      { projects: [{ title: '電子紙' }, { title: '搬家' }], weeklyFocus: [], people: [] },
    )
    const { record, failed } = await archiveProject(' 電子紙 ', deps)
    expect(failed).toEqual([])
    expect(record).toEqual({
      name: '電子紙', archivedAt: 42,
      notes: [{ path: '40 專案/電子紙.md', previousStatus: 'valid' }],
      context: [{ title: '電子紙' }],
    })
    expect(files.size).toBe(3)
    expect(parseV3Note(files.get('40 專案/電子紙.md')!).fields.status).toBe('archived')
    expect(files.get('知識/墨水屏刷新.md')).toBe(KNOWLEDGE)
    expect(files.get('40 專案/搬家.md')).toBe(PROJECT_NO_STATUS)
    expect(deps.rewriteNote).toHaveBeenCalledTimes(1)
    expect(state.context.projects).toEqual([{ title: '搬家' }])

    // store.json 來回一趟不變
    const saved = sanitizeArchivedProjects(JSON.parse(JSON.stringify({ [record.name]: record })))
    expect(saved).toEqual({ 電子紙: record })
    expect(isProjectArchived(saved, '電子紙')).toBe(true)
    expect(archivedNames(saved)).toEqual(new Set(['電子紙']))

    const restored = await restoreProject(saved['電子紙'], deps)
    expect(restored.failed).toEqual([])
    expect(files.get('40 專案/電子紙.md')).toBe(PROJECT)
    expect(files.get('知識/墨水屏刷新.md')).toBe(KNOWLEDGE)
    expect(state.context.projects).toEqual([{ title: '搬家' }, { title: '電子紙' }])
  })

  it('原本就封存的專案筆記不記進紀錄，取消封存也不動它', async () => {
    const already = archiveNoteRaw(PROJECT)!
    const { files, deps } = fakeVault({ 'a.md': already }, { projects: [], weeklyFocus: [], people: [] })
    const { record } = await archiveProject('電子紙', deps)
    expect(record.notes).toEqual([])
    await restoreProject(record, deps)
    expect(files.get('a.md')).toBe(already)
    expect(deps.saveContext).not.toHaveBeenCalled()
  })

  it('筆記讀寫失敗或脈絡寫不進去不擋結束專案；被刪掉的筆記取消封存時跳過', async () => {
    const { files, deps } = fakeVault({ 'a.md': PROJECT, 'b.md': PROJECT.replace('status: valid\n', '') }, { projects: [{ title: '電子紙' }], weeklyFocus: [], people: [] })
    const rewrite = deps.rewriteNote
    deps.rewriteNote = vi.fn(async (path, fn) => {
      if (path === 'b.md') throw new Error('busy')
      return rewrite(path, fn)
    })
    deps.saveContext = vi.fn(async () => { throw new Error('db') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { record, failed } = await archiveProject('電子紙', deps)
    expect(failed).toEqual(['b.md'])
    expect(record.notes).toEqual([{ path: 'a.md', previousStatus: 'valid' }])
    expect(record.context).toEqual([])

    files.delete('a.md')
    deps.rewriteNote = rewrite
    expect((await restoreProject(record, deps)).failed).toEqual(['a.md'])
    warn.mockRestore()
  })

  it('空的專案名丟錯', async () => {
    const { deps } = fakeVault({}, { projects: [], weeklyFocus: [], people: [] })
    await expect(archiveProject('   ', deps)).rejects.toThrow()
  })
})

describe('projects/archive：store.json', () => {
  it('壞資料丟掉，依封存時間列出', () => {
    const map = sanitizeArchivedProjects({
      x: { name: ' B ', archivedAt: 2, notes: [{ path: 'b.md', previousStatus: 'weird' }, { path: '' }, 3], context: [{ title: '' }, { title: 'B', link: ' ' }] },
      y: { name: 'A', archivedAt: 5 },
      z: { name: '   ' },
      w: 'nope',
    })
    expect(map).toEqual({
      B: { name: 'B', archivedAt: 2, notes: [{ path: 'b.md', previousStatus: null }], context: [{ title: 'B' }] },
      A: { name: 'A', archivedAt: 5, notes: [], context: [] },
    })
    expect(listArchivedProjects(map).map(record => record.name)).toEqual(['A', 'B'])
    expect(sanitizeArchivedProjects(null)).toEqual({})
    expect(sanitizeArchivedProjects([1])).toEqual({})
  })
})
