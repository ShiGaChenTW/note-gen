import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { formalEntries, parseMoc } from '@/lib/moc/parse'
import { inverseOf } from './inverse'
import { createOpsService } from './service'
import { createMemoryOpsIo, createMemoryOpsStore } from './testing'
import { UNDO_WINDOW_MS, type OpRecord, type OpSpec } from './types'

const MOC_PATH = '20 領域/時間管理.md'
const M = 'M-20261112-060012-VPB3'
const C_WHAT = 'C-20261112-060020-N9NR'
const C_WHEN = 'C-20261112-060024-3XSV'
const N_NEW = 'N-20261123-090000-AAAA'
const N_SAY_NO = 'N-20261110-063015-B3XR'
const fixture = readFileSync(join(__dirname, '..', 'moc', 'fixtures', '時間管理.md'), 'utf8')
const note = (id: string, body = '內文') => `---\nid: ${id}\ntype: knowledge\n---\n${body}\n`

function vault() {
  return {
    [MOC_PATH]: fixture,
    '10 知識/說不比提高效率更省時間.md': note(N_SAY_NO),
    '10 知識/新筆記.md': note(N_NEW),
  } as Record<string, string>
}

const ids = { [M]: MOC_PATH, [N_SAY_NO]: '10 知識/說不比提高效率更省時間.md', [N_NEW]: '10 知識/新筆記.md' }

function setup(files = vault(), rows: OpRecord[] = [], clock = { now: 1_000_000 }) {
  const io = createMemoryOpsIo(files, ids)
  const store = createMemoryOpsStore(rows)
  const afterChange = vi.fn(async () => {})
  const service = createOpsService({ fs: io.fs, writer: io.writer, store, now: () => clock.now, afterChange })
  return { io, store, service, files, clock, afterChange }
}

function chapterOf(raw: string, title: string): string | null | undefined {
  return formalEntries(parseMoc(raw, MOC_PATH)).find(({ entry }) => entry.target === title)?.chapter.id
}

const scott = { actor: 'scott' as const, actorId: 'scott' }

const ref = { noteTitle: '說不比提高效率更省時間', notePath: '10 知識/說不比提高效率更省時間.md', noteId: N_SAY_NO, mocId: M, mocName: '時間管理', mocPath: MOC_PATH }
const newRef = { noteTitle: '新筆記', notePath: '10 知識/新筆記.md', noteId: N_NEW, mocId: M, mocName: '時間管理', mocPath: MOC_PATH }

describe('inverseOf', () => {
  it('is its own inverse for every kind', () => {
    const specs: OpSpec[] = [
      { kind: 'note.create', path: 'a.md', title: 'a', content: 'x' },
      { kind: 'note.edit', path: 'a.md', title: 'a', before: 'x', after: 'y' },
      { kind: 'note.move', title: 'a', from: 'a.md', to: 'b/a.md' },
      { kind: 'moc.entry.add', ...ref, chapterId: C_WHAT, relation: 'r' },
      { kind: 'moc.entry.move', ...ref, fromChapterId: C_WHAT, toChapterId: C_WHEN },
      { kind: 'domain.create', name: 'X', path: 'X.md', content: 'c', mocId: M },
    ]
    for (const spec of specs) expect(inverseOf(inverseOf(spec))).toEqual(spec)
    expect(inverseOf(specs[0]).kind).toBe('note.delete')
    expect(inverseOf(specs[3]).kind).toBe('moc.entry.remove')
  })
})

describe('apply and undo are inverse for each kind', () => {
  it('note.create ↔ removes the file', async () => {
    const { service, files } = setup()
    const [op] = await service.applyOps([{ kind: 'note.create', noteId: 'N-20261123-100000-CCCC', path: '10 知識/另一則.md', title: '另一則', content: note('N-20261123-100000-CCCC') }], scott)
    expect(files['10 知識/另一則.md']).toContain('N-20261123-100000-CCCC')
    expect((await service.undoOp(op.id)).status).toBe('undone')
    expect(files['10 知識/另一則.md']).toBeUndefined()
  })

  it('note.edit ↔ writes back the previous version', async () => {
    const { service, files } = setup()
    const before = files['10 知識/新筆記.md']
    const after = note(N_NEW, '改過的內文')
    const [op] = await service.applyOps([{ kind: 'note.edit', noteId: N_NEW, path: '10 知識/新筆記.md', title: '新筆記', before, after }], scott)
    expect(files['10 知識/新筆記.md']).toBe(after)
    await service.undoOp(op.id)
    expect(files['10 知識/新筆記.md']).toBe(before)
  })

  it('note.move ↔ moves back (path resolved by N id)', async () => {
    const { service, files, io } = setup()
    const [op] = await service.applyOps([{ kind: 'note.move', noteId: N_NEW, title: '新筆記', from: '10 知識/新筆記.md', to: '30 封存/新筆記.md' }], scott)
    expect(files['30 封存/新筆記.md']).toBeDefined()
    expect(io.ids.get(N_NEW)).toBe('30 封存/新筆記.md')
    await service.undoOp(op.id)
    expect(files['10 知識/新筆記.md']).toBeDefined()
    expect(files['30 封存/新筆記.md']).toBeUndefined()
  })

  it('moc.entry.add ↔ removes only that entry (N in M, by id)', async () => {
    const { service, files, afterChange } = setup()
    const [op] = await service.applyOps([{ kind: 'moc.entry.add', ...newRef, chapterId: C_WHEN, relation: '新的關係' }], scott)
    expect(chapterOf(files[MOC_PATH], '新筆記')).toBe(C_WHEN)
    expect(afterChange).toHaveBeenCalledTimes(1)
    await service.undoOp(op.id)
    expect(files[MOC_PATH]).toBe(fixture)
    expect(afterChange).toHaveBeenCalledTimes(2)
  })

  it('moc.entry.remove ↔ adds it back to the same chapter with the same relation', async () => {
    const { service, files } = setup()
    const [op] = await service.applyOps([{ kind: 'moc.entry.remove', ...ref, chapterId: C_WHAT, relation: '和下一章互補：先刪，再排' }], scott)
    expect(chapterOf(files[MOC_PATH], '說不比提高效率更省時間')).toBeUndefined()
    await service.undoOp(op.id)
    expect(files[MOC_PATH]).toBe(fixture)
  })

  it('moc.entry.move ↔ moves back to the original chapter', async () => {
    const { service, files } = setup()
    const [op] = await service.applyOps([{ kind: 'moc.entry.move', ...ref, fromChapterId: C_WHAT, toChapterId: C_WHEN }], scott)
    expect(chapterOf(files[MOC_PATH], '說不比提高效率更省時間')).toBe(C_WHEN)
    await service.undoOp(op.id)
    expect(chapterOf(files[MOC_PATH], '說不比提高效率更省時間')).toBe(C_WHAT)
  })

  it('domain.create ↔ removes the new MOC file', async () => {
    const { service, files } = setup()
    const [op] = await service.applyOps([{ kind: 'domain.create', mocId: 'M-20261123-100000-DDDD', name: '寫作', path: '20 領域/寫作.md', content: '---\nkind: domain\n---\n# 寫作\n' }], scott)
    expect(files['20 領域/寫作.md']).toBeDefined()
    await service.undoOp(op.id)
    expect(files['20 領域/寫作.md']).toBeUndefined()
  })

  it('records already-written changes (recordOps) and undoes them', async () => {
    const { service, files } = setup()
    files['10 知識/手寫.md'] = note('N-20261123-110000-EEEE')
    const [op] = await service.recordOps([{ spec: { kind: 'note.create', path: '10 知識/手寫.md', title: '手寫', content: files['10 知識/手寫.md'] } }], scott)
    expect(op.baseVersions['10 知識/手寫.md']).toBeTruthy()
    await service.undoOp(op.id)
    expect(files['10 知識/手寫.md']).toBeUndefined()
  })
})

describe('undo after reopening the App, the 7-day window', () => {
  it('a new service over the same stored rows can still undo', async () => {
    const files = vault()
    const first = setup(files)
    const [op] = await first.service.applyOps([{ kind: 'moc.entry.add', ...newRef }], scott)
    // 重開 App：新的 store 物件、新的 service，只有資料表的資料留著。
    const reopened = setup(files, first.store.rows, { now: first.clock.now + UNDO_WINDOW_MS - 1 })
    expect((await reopened.service.undoOp(op.id)).status).toBe('undone')
    expect(files[MOC_PATH]).toBe(fixture)
    expect(reopened.store.rows[0].undoneAt).toBe(first.clock.now + UNDO_WINDOW_MS - 1)
    expect((await reopened.service.undoOp(op.id)).status).toBe('already-undone')
  })

  it('exactly 7 days later it is expired and nothing is written', async () => {
    const { service, files, clock } = setup()
    const [op] = await service.applyOps([{ kind: 'moc.entry.add', ...newRef }], scott)
    const added = files[MOC_PATH]
    clock.now += UNDO_WINDOW_MS
    expect((await service.undoOp(op.id)).status).toBe('expired')
    expect(files[MOC_PATH]).toBe(added)
  })

  it('prune drops ops older than 7 days', async () => {
    const { service, store, clock } = setup()
    await service.applyOps([{ kind: 'moc.entry.add', ...newRef }], scott)
    clock.now += UNDO_WINDOW_MS - 1
    expect(await service.prune()).toBe(0)
    clock.now += 2
    expect(await service.prune()).toBe(1)
    expect(store.rows).toEqual([])
  })
})

describe('version check', () => {
  it('a later change returns a compare card instead of overwriting; force still undoes by id', async () => {
    const { service, files } = setup()
    const [op] = await service.applyOps([{ kind: 'moc.entry.add', ...newRef }], scott)
    // Scott 之後在 Obsidian 又在第一章加了一條。
    files[MOC_PATH] = files[MOC_PATH].replace('- [[說不比提高效率更省時間]]', '- [[後來加的]] ── 手動\n- [[說不比提高效率更省時間]]')
    const changed = files[MOC_PATH]
    const result = await service.undoOp(op.id)
    expect(result.status).toBe('conflict')
    if (result.status !== 'conflict') return
    expect(files[MOC_PATH]).toBe(changed)
    expect(result.files).toEqual([{ path: MOC_PATH, current: changed, restored: expect.any(String), changed: true }])
    // 還原後：只拿掉新筆記那一條，後來加的留著。
    expect(result.files[0].restored).toContain('[[後來加的]]')
    expect(result.files[0].restored).not.toContain('[[新筆記]]')
    expect((await service.undoOp(op.id, { force: true })).status).toBe('undone')
    expect(files[MOC_PATH]).toBe(result.files[0].restored)
  })

  it('a later edit of a created note shows restored (removed) vs current', async () => {
    const { service, files } = setup()
    const path = '10 知識/另一則.md'
    const [op] = await service.applyOps([{ kind: 'note.create', path, title: '另一則', content: note('N-20261123-100000-CCCC') }], scott)
    files[path] = note('N-20261123-100000-CCCC', 'Scott 加了一段')
    const result = await service.undoOp(op.id)
    expect(result).toMatchObject({ status: 'conflict', files: [{ path, restored: null, current: files[path], changed: true }] })
    expect(files[path]).toContain('Scott 加了一段')
  })

  it('domains rewritten by the MOC rebuild do not count as a later change', async () => {
    const { service, files } = setup()
    const path = '10 知識/另一則.md'
    const [op] = await service.applyOps([{ kind: 'note.create', path, title: '另一則', content: note('N-20261123-100000-CCCC') }], scott)
    files[path] = files[path].replace('type: knowledge\n', 'type: knowledge\ndomains:\n  - 時間管理\n')
    expect((await service.undoOp(op.id)).status).toBe('undone')
  })
})

describe('batch undo (撤回這次整理)', () => {
  it('undoes every op of the batch in reverse order; later ops on the same file are not a conflict', async () => {
    const { service, files, io } = setup()
    const batch = { actor: 'commander' as const, actorId: 'mia', proposalId: 'collect:1:2', batchId: 'batch-1' }
    const path = '10 知識/提案筆記.md'
    const id = 'N-20261123-130000-FFFF'
    files[path] = note(id)
    io.ids.set(id, path)
    const records = await service.recordOps([{ spec: { kind: 'note.create', noteId: id, path, title: '提案筆記', content: files[path] } }], batch)
    const added = await service.applyOps([
      { kind: 'moc.entry.add', ...newRef },
      { kind: 'moc.entry.add', noteId: id, noteTitle: '提案筆記', notePath: path, mocId: M, mocName: '時間管理', mocPath: MOC_PATH },
    ], batch)
    expect([...records, ...added].every(record => record.batchId === 'batch-1' && record.proposalId === 'collect:1:2')).toBe(true)
    const result = await service.undoBatch('batch-1')
    expect(result.status).toBe('undone')
    expect(files[MOC_PATH]).toBe(fixture)
    expect(files[path]).toBeUndefined()
  })

  it('a batch with a later change returns one compare card for all files', async () => {
    const { service, files } = setup()
    const batch = { ...scott, batchId: 'batch-2' }
    await service.applyOps([
      { kind: 'moc.entry.add', ...newRef },
      { kind: 'note.edit', noteId: N_NEW, path: '10 知識/新筆記.md', title: '新筆記', before: files['10 知識/新筆記.md'], after: note(N_NEW, '改') },
    ], batch)
    files['10 知識/新筆記.md'] = note(N_NEW, '又改')
    const result = await service.undoBatch('batch-2')
    expect(result.status).toBe('conflict')
    if (result.status !== 'conflict') return
    expect(result.files.map(file => [file.path, file.changed]).sort()).toEqual([['10 知識/新筆記.md', true], [MOC_PATH, false]])
    expect(files[MOC_PATH]).not.toBe(fixture)
  })
})
