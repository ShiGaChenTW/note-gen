// Fork（almanac ALMNC-54.12）：接受清理提案的寫入——全部比對通過才寫、被改過就整則不寫、寫到一半失敗會還原。
import { describe, expect, it } from 'vitest'
import { applyEdits, EditsNotApplied, type EditIo } from './apply'

function memoryIo(files: Record<string, string>, extra: Partial<EditIo> = {}) {
  const store = new Map(Object.entries(files))
  const domains = new Map([['ie', '# 工業工程\n']])
  let workNotes = '- Scott 喜歡附來源\n- 節拍時間是 60 秒'
  const io: EditIo = {
    readNote: async path => store.get(path) ?? null,
    writeNote: async (path, content) => { store.set(path, content) },
    removeNote: async path => { store.delete(path) },
    getDomainOverview: async id => domains.get(id),
    setDomainOverview: async (id, overview) => { domains.set(id, overview) },
    getWorkNotes: async () => workNotes,
    setWorkNotes: async (_agent, content) => { workNotes = content },
    ...extra,
  }
  return { io, store, domains, workNotes: () => workNotes }
}

const agent = { id: 'exp_1', name: 'Alex', role: 'expert' as const, domain: '工業工程' }

describe('applyEdits', () => {
  it('writes notes, new notes, domains and memory together', async () => {
    const { io, store, domains, workNotes } = memoryIo({ 'a.md': 'A' })
    const targets = await applyEdits({
      edits: [{ path: 'a.md', baseContent: 'A', content: 'A2', summary: 'a' }, { path: 'new.md', baseContent: null, content: 'N', summary: 'n' }],
      domainEdits: [{ domainId: 'ie', baseOverview: '# 工業工程\n', overview: '# 工業工程\n\n## 矛盾與未解問題\n', summary: '工業工程' }],
      memoryEdits: [{ target: 'work_notes', agent, baseContent: '- Scott 喜歡附來源\n- 節拍時間是 60 秒', content: '- Scott 喜歡附來源', summary: 'Alex' }],
    }, io)
    expect(targets).toEqual(['a.md', 'new.md', 'domain:ie', 'memory:exp_1'])
    expect(store.get('a.md')).toBe('A2')
    expect(store.get('new.md')).toBe('N')
    expect(domains.get('ie')).toContain('矛盾與未解問題')
    expect(workNotes()).toBe('- Scott 喜歡附來源')
  })

  it('writes nothing when any target changed after the proposal (never silently overwrite)', async () => {
    const { io, store } = memoryIo({ 'a.md': 'A', 'b.md': 'B 被 Scott 改過', 'new.md': '已經有了' })
    const attempt = applyEdits({ edits: [
      { path: 'a.md', baseContent: 'A', content: 'A2', summary: '' },
      { path: 'b.md', baseContent: 'B', content: 'B2', summary: '' },
      { path: 'new.md', baseContent: null, content: 'N', summary: '' },
    ] }, io)
    await expect(attempt).rejects.toMatchObject({ conflict: true, targets: ['b.md', 'new.md'] })
    expect(store.get('a.md')).toBe('A')
  })

  it('rolls back what was written when a later write fails', async () => {
    const files = memoryIo({ 'a.md': 'A', 'b.md': 'B' })
    const io: EditIo = { ...files.io, writeNote: async (path, content) => {
      if (path === 'b.md' && content === 'B2') throw new Error('disk full')
      files.store.set(path, content)
    } }
    const attempt = applyEdits({ edits: [
      { path: 'a.md', baseContent: 'A', content: 'A2', summary: '' },
      { path: 'new.md', baseContent: null, content: 'N', summary: '' },
      { path: 'b.md', baseContent: 'B', content: 'B2', summary: '' },
    ] }, io)
    await expect(attempt).rejects.toBeInstanceOf(EditsNotApplied)
    expect(files.store.get('a.md')).toBe('A')
    expect(files.store.has('new.md')).toBe(false)
  })

  it('refuses domain or memory edits without a writer', async () => {
    const { io } = memoryIo({}, { getDomainOverview: undefined })
    await expect(applyEdits({ domainEdits: [{ domainId: 'ie', baseOverview: '', overview: 'x', summary: '' }] }, io)).rejects.toMatchObject({ conflict: false })
  })
})
