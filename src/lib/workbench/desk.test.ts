// Fork（almanac ALMNC-54.8）：檯面（AC#5）——結構操作直接生效（搬移、加標籤、連結、歸入領域）。
import { describe, expect, it, vi } from 'vitest'
import { parseV3Note } from '@/lib/v3-model/note'
import { assignToMocs } from '@/lib/moc/service'
import { createMemoryMocIo } from '@/lib/moc/testing'
import { parseMoc } from '@/lib/moc/parse'
import { STRUCTURAL_OPS, applyStructuralOp, deskHeading, handwrittenNote, initialDraft, mergeDeskDraft, noteFileName, type NoteIo } from './desk'

function memoryIo(files: Record<string, string>): NoteIo & { files: Record<string, string> } {
  return {
    files,
    read: async path => files[path] ?? null,
    write: async (path, content) => { files[path] = content },
    move: vi.fn(async (path: string, folder: string) => {
      const to = `${folder ? `${folder}/` : ''}${path.split('/').pop()}`
      files[to] = files[path]!
      delete files[path]
      return to
    }),
    // Fork（almanac ALMNC-69.7）：歸入領域走 MOC（同 actions.ts defaultNoteIo，只是 I/O 換成記憶體）。
    assignDomain: async (path, domainId) => (await assignToMocs(createMemoryMocIo(files, { domainNames: { dom_1: '工業工程' } }), [{ notePath: path, domain: domainId }])).undo,
  }
}

describe('desk structural operations', () => {
  it('offers the four operations that apply to individual notes', () => {
    expect(STRUCTURAL_OPS).toEqual(['move', 'tag', 'link', 'assignDomain'])
  })

  it('AC#5: tag and link write the note frontmatter directly and can be undone', async () => {
    const io = memoryIo({ 'inbox/a.md': '# A\n內文\n' })
    const tagged = await applyStructuralOp({ op: 'tag', path: 'inbox/a.md', tag: '#產線 平衡' }, io)
    expect(parseV3Note(io.files['inbox/a.md']).fields.tags).toEqual(['產線-平衡'])
    await applyStructuralOp({ op: 'link', path: 'inbox/a.md', target: '知識/節拍時間.md' }, io)
    expect(parseV3Note(io.files['inbox/a.md']).fields.related).toEqual(['[[知識/節拍時間]]'])
    expect(io.files['inbox/a.md']).toContain('# A\n內文')
    await tagged.undo!()
    expect(io.files['inbox/a.md']).toBe('# A\n內文\n')
  })

  it('ALMNC-69.7: assign-domain writes a MOC entry (尚未分章), domains follow from the rebuild, and it can be undone', async () => {
    const moc = '---\nid: M-20261120-000000-IEIE\nkind: domain\nlevel: 1\n---\n# 工業工程\n\n## ③ 章節\n\n### 換模\n<!-- C-20261120-000001-SMED -->\n- [[b]] ── 例子\n'
    const io = memoryIo({ 'inbox/a.md': '---\ntype: knowledge\n---\n# A\n', 'inbox/b.md': '---\ntype: knowledge\ndomains: [工業工程]\n---\n# B\n', '20 領域/工業工程.md': moc })
    const result = await applyStructuralOp({ op: 'assignDomain', path: 'inbox/a.md', domainId: 'dom_1' }, io)
    expect(parseMoc(io.files['20 領域/工業工程.md']).unsorted?.entries.map(entry => entry.target)).toEqual(['a'])
    expect(parseV3Note(io.files['inbox/a.md']).fields.domains).toEqual(['工業工程'])
    await result.undo!()
    expect(io.files['20 領域/工業工程.md']).toBe(moc)
    expect(parseV3Note(io.files['inbox/a.md']).fields.domains).toEqual([])
  })

  it('AC#5: move relocates the note and undo moves it back', async () => {
    const io = memoryIo({ 'inbox/a.md': 'A' })
    const result = await applyStructuralOp({ op: 'move', path: 'inbox/a.md', folder: '/知識/工業工程/' }, io)
    expect(result.path).toBe('知識/工業工程/a.md')
    expect(io.files['知識/工業工程/a.md']).toBe('A')
    await result.undo!()
    expect(io.files['inbox/a.md']).toBe('A')
  })

  it('does nothing when the tag or link is already there', async () => {
    const io = memoryIo({ 'a.md': '---\ntags: [x]\n---\nA' })
    const write = vi.spyOn(io, 'write')
    await applyStructuralOp({ op: 'tag', path: 'a.md', tag: 'x' }, io)
    await applyStructuralOp({ op: 'link', path: 'a.md', target: 'a.md' }, io)
    expect(write).not.toHaveBeenCalled()
  })

})

describe('desk draft', () => {
  const materials = [
    { id: 'n1', kind: 'note' as const, title: '產線平衡率', text: '平衡率＝…', path: '知識/產線平衡率.md' },
    { id: 'src:s1', kind: 'source' as const, title: '11/19 產線檢討', text: '第三站每小時 42 件', sourceId: 's1' },
  ]

  it('titles the desk 「first 等 N 則」 and seeds the working draft', () => {
    expect(deskHeading(materials)).toEqual({ first: '產線平衡率', more: 1 })
    expect(initialDraft(materials).body).toBe('## 產線平衡率\n\n平衡率＝…\n\n## 11/19 產線檢討\n\n第三站每小時 42 件')
  })

  it('saves the draft as a handwritten note with sources and related notes', () => {
    const note = parseV3Note(handwrittenNote({ title: '產線平衡：從瓶頸開始', body: '整條線的產出由最慢的工站決定。' }, materials, '親手寫的'))
    expect(note.fields).toMatchObject({ title: '產線平衡：從瓶頸開始', tags: ['親手寫的'], sources: ['s1'], related: ['[[知識/產線平衡率]]'] })
    expect(note.body.trim()).toBe('整條線的產出由最慢的工站決定。')
    expect(noteFileName('產線/平衡: 瓶頸?', '檯面筆記')).toBe('產線 平衡 瓶頸.md')
    expect(noteFileName('  ', '檯面筆記')).toBe('檯面筆記.md')
  })
})


describe('ALMNC-54.22 desk merge', () => {
  const original = [
    { id: 'a', kind: 'note' as const, path: 'a.md', title: 'A', text: '原文 A', noteRaw: '---\nsources: [one, two]\ndomains: [d1]\ncustom: 珍惜\n---\n原文 A\n' },
    { id: 'b', kind: 'note' as const, path: 'b.md', title: 'B', text: '原文 B', noteRaw: '---\nsources: [two, three]\ndomains: [d2]\n---\n原文 B\n' },
  ]
  const options = { today: '2026-11-23', handTag: '親手寫的', reason: '在檯面合併', sourceIds: ['three', 'db-only'] }
  const draft = { title: '合併後', body: 'Scott 寫的新稿' }

  it('uses the edited draft, unions sources and archives originals with a merge link and history', () => {
    const plan = mergeDeskDraft(draft, original, 'merged.md', options)
    const merged = parseV3Note(plan.content)
    expect(plan.sources).toEqual(['one', 'two', 'three', 'db-only'])
    expect(merged.fields).toMatchObject({
      title: '合併後', sources: plan.sources, domains: ['d1', 'd2'], related: ['[[a]]', '[[b]]'], tags: ['親手寫的'],
    })
    expect(merged.body).toBe('Scott 寫的新稿\n')
    expect(plan.writes.map(write => write.before)).toEqual(original.map(note => note.noteRaw))
    for (const [index, write] of plan.writes.entries()) {
      const archived = parseV3Note(write.after)
      expect(archived.fields).toMatchObject({ status: 'archived', related: ['[[merged]]'] })
      expect(archived.body).toContain(original[index].text)
      expect(archived.body).toContain('已合併到 [[merged]]')
    }
    expect(parseV3Note(plan.writes[0].after).extra).toMatchObject({ custom: '珍惜' })
  })

  it('rejects duplicate paths and missing originals', () => {
    expect(() => mergeDeskDraft(draft, [original[0], original[0]], 'merged.md', options)).toThrow()
    expect(() => mergeDeskDraft(draft, [original[0], { ...original[1], noteRaw: undefined }], 'merged.md', options)).toThrow()
  })
})
