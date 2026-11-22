// Fork（almanac ALMNC-54.8）：檯面（AC#5）——結構操作直接生效（搬移、加標籤、連結、歸入領域）；合併筆記先不開放。
import { describe, expect, it, vi } from 'vitest'
import { parseV3Note } from '@/lib/v3-model/note'
import { DeskOpUnsupported, STRUCTURAL_OPS, STUBBED_OPS, applyStructuralOp, deskHeading, handwrittenNote, initialDraft, noteFileName, type NoteIo } from './desk'

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
  }
}

describe('desk structural operations', () => {
  it('offers move, tag, link and assign-domain; merge is stubbed', () => {
    expect(STRUCTURAL_OPS).toEqual(['move', 'tag', 'link', 'assignDomain'])
    expect(STUBBED_OPS).toEqual(['merge'])
  })

  it('AC#5: tag, link and assign-domain write the note frontmatter directly and can be undone', async () => {
    const io = memoryIo({ 'inbox/a.md': '# A\n內文\n' })
    const tagged = await applyStructuralOp({ op: 'tag', path: 'inbox/a.md', tag: '#產線 平衡' }, io)
    expect(parseV3Note(io.files['inbox/a.md']).fields.tags).toEqual(['產線-平衡'])
    await applyStructuralOp({ op: 'link', path: 'inbox/a.md', target: '知識/節拍時間.md' }, io)
    expect(parseV3Note(io.files['inbox/a.md']).fields.related).toEqual(['[[知識/節拍時間]]'])
    await applyStructuralOp({ op: 'assignDomain', path: 'inbox/a.md', domainId: 'dom_1' }, io)
    expect(parseV3Note(io.files['inbox/a.md']).fields.domains).toEqual(['dom_1'])
    expect(io.files['inbox/a.md']).toContain('# A\n內文')
    await tagged.undo!()
    expect(io.files['inbox/a.md']).toBe('# A\n內文\n')
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

  it('merge is not available yet', async () => {
    await expect(applyStructuralOp({ op: 'merge', paths: ['a.md', 'b.md'] }, memoryIo({}))).rejects.toBeInstanceOf(DeskOpUnsupported)
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
