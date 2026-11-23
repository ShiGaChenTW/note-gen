import { describe, expect, it } from 'vitest'
import { createMemoryOpsIo, createMemoryOpsStore } from '@/lib/ops/testing'
import { createOpsService } from '@/lib/ops/service'
import { branchOrigin, planMocBranch, type BranchFile } from './branching'
import { FOUR_WEEKS, observeMocPositions, splitCandidates } from './positions'
import { membershipsFromMocs, planDomainRebuild } from './membership'
import { formalEntries, parseMoc } from './parse'

const root = 'M-20261123-120000-ROOT'
const child = 'M-20261123-120000-CHLD'
const sibling = 'M-20261123-120000-SIBL'
const chapter = 'C-20261123-120000-CHAP'
const moved = 'C-20261123-120000-MOVE'
const path = 'MOCs/Root.md'
const childPath = 'MOCs/Growing.md'
const row = (name: string) => `- [[${name}]] ── why ${name}`
const raw = (rows: string[], name = 'Root', id = root) => [
  '---', `id: ${id}`, 'kind: domain', 'level: 1', '---', `# ${name}`,
  '## ③ 章節', '### Growing', `<!-- ${chapter} -->`, ...rows, '', '## ④ 重點結論', 'keep this',
].join('\n')
const resolve = (target: string) => `notes/${target.split('/').pop()}.md`
const file = (raw: string, path: string): BranchFile => ({ raw, path, moc: parseMoc(raw, path) })
const split = { kind: 'split', mocId: root, chapterId: chapter } as const
const names = Array.from({ length: 12 }, (_, index) => `Note ${index}`)
const original = raw(names.map(row))
const options = { resolve, destination: { id: child, path: childPath, chapterId: moved } }

describe('MOC positions', () => {
  it('requires 12 distinct notes and four weeks without any entry or exit', () => {
    const moc = parseMoc(original, path)
    const baseline = observeMocPositions(moc, null, resolve, 0)
    expect(splitCandidates(moc, baseline, resolve, FOUR_WEEKS - 7 * 86_400_000)).toEqual([])
    expect(splitCandidates(moc, baseline, resolve, FOUR_WEEKS)).toEqual([{ chapterId: chapter, title: 'Growing', count: 12 }])
    const fewer = parseMoc(raw(names.slice(0, 11).map(row)), path)
    expect(splitCandidates(fewer, observeMocPositions(fewer, baseline, resolve, 1), resolve, FOUR_WEEKS * 2)).toEqual([])
    const more = parseMoc(raw([...names.map(row), row('Another')]), path)
    const newer = observeMocPositions(more, baseline, resolve, 2)
    const removed = observeMocPositions(moc, newer, resolve, FOUR_WEEKS - 1)
    expect(splitCandidates(moc, removed, resolve, FOUR_WEEKS)).toEqual([])
    expect(removed[chapter].entries['notes/Note 0.md']).toBe(0)
  })
})

describe('MOC branching', () => {
  it('changes membership and its primary order, dedupes by resolved note, and undoes both batches', async () => {
    const otherId = 'M-20261123-120000-OTHR'
    const otherPath = 'MOCs/Other.md'
    const withDuplicate = raw([...names.map(row), row('notes/Note 0')])
    const memory = createMemoryOpsIo({ [path]: withDuplicate, [otherPath]: raw([row(names[0])], 'Other', otherId) })
    const notes = new Map(names.map(name => [resolve(name), name === names[0] ? ['Root', 'Other'] : ['Root']]))
    const files = () => Object.entries(memory.files).map(([path, raw]) => file(raw, path))
    const makePlan = (request: Parameters<typeof planMocBranch>[0]) => planMocBranch(request, files(), { ...options, noteDomains: notes })
    const store = createMemoryOpsStore()
    let now = 0
    const service = createOpsService({ ...memory, store, now: () => now, afterChange: async specs => {
      const mocs = files().map(item => item.moc)
      const managed = new Set([...mocs.map(moc => moc.name), ...specs.flatMap(spec => spec.kind === 'domain.remove' ? [spec.name] : [])])
      const preferredOrder = new Map(specs.flatMap(spec => spec.kind === 'note.edit' ? spec.domainOrder?.map(item => [item.path, item.after] as const) ?? [] : []))
      const { changes } = planDomainRebuild([...notes].map(([path, domains]) => ({ path, domains })), membershipsFromMocs(mocs, resolve).byNote, { managed, preferredOrder })
      for (const change of changes) notes.set(change.path, change.after)
    } })
    const context = { actor: 'scott', batchId: 'split' } as const
    await service.applyOps(makePlan(split), context, { guardedBatch: true })
    const created = parseMoc(memory.files[childPath], childPath)
    expect(created).toMatchObject({ parent: root, level: 2 })
    expect(branchOrigin(created)).toEqual({ mocId: root, chapterId: chapter })
    expect(formalEntries(created)).toHaveLength(12)
    expect(formalEntries(parseMoc(memory.files[path], path))).toHaveLength(0)
    expect(memory.files[path]).toContain('keep this')
    expect([...notes.values()]).toEqual(names.map((_, i) => i === 0 ? ['Growing', 'Other'] : ['Growing']))
    now = 6 * 86_400_000
    const beforeMerge = { ...memory.files }
    await service.applyOps(makePlan({ kind: 'merge', mocId: child }), { ...context, batchId: 'merge' }, { guardedBatch: true })
    expect(memory.files[childPath]).toBeUndefined()
    expect(notes.get(resolve(names[0]))).toEqual(['Root', 'Other'])
    expect(formalEntries(parseMoc(memory.files[path], path))).toHaveLength(12)
    expect((await service.undoBatch('merge')).status).toBe('undone')
    expect(memory.files).toEqual(beforeMerge)
    expect(notes.get(resolve(names[0]))).toEqual(['Growing', 'Other'])
    expect((await service.undoBatch('split')).status).toBe('undone')
    expect(memory.files[path]).toBe(withDuplicate)
    expect(memory.files[childPath]).toBeUndefined()
    expect([...notes.values()]).toEqual(names.map((_, i) => i === 0 ? ['Root', 'Other'] : ['Root']))
  })

  it('places a second-level branch beside its source and refuses a missing top-level parent', () => {
    const top = file(original, path)
    const lowerRaw = raw([row('A')], 'Growing', child).replace('level: 1', `level: 2\nparent: ${root}`).replace('### Growing', '### Focus')
    const lower = file(lowerRaw, childPath)
    const request = { ...split, mocId: child }
    const destination = { id: sibling, path: 'MOCs/Focus.md', chapterId: moved }
    const [created] = planMocBranch(request, [top, lower], { resolve, destination })
    expect(created.kind).toBe('domain.create')
    if (created.kind !== 'domain.create') throw new Error('Expected new MOC')
    const moc = parseMoc(created.content, created.path)
    expect(moc).toMatchObject({ level: 2, parent: root })
    expect(branchOrigin(moc)).toEqual({ mocId: child, chapterId: chapter })
    expect(() => planMocBranch(request, [lower], { resolve, destination })).toThrow()
  })
})

it('merges only current formal membership and keeps an existing destination entry in its chapter', () => {
  const resolver = (target: string) => target === 'MOCs/Growing' ? childPath : resolve(target)
  const extraChapter = 'C-20261123-120000-XTRA'
  const originalWithOther = original.replace('## ④', `### Existing\n<!-- ${extraChapter} -->\n${row('New')}\n\n## ④`)
  const [create, edit] = planMocBranch(split, [file(originalWithOther, path)], { ...options, resolve: resolver })
  if (create.kind !== 'domain.create' || edit.kind !== 'note.edit') throw new Error('Expected split ops')
  const childNow = create.content.replace(/^- \[\[notes\/Note 1\]\].*$/m, row('New')).replace(/^- \[\[notes\/Note 2\]\].*$/m, row('Newest'))
  const [merge] = planMocBranch({ kind: 'merge', mocId: child }, [file(edit.after, path), file(childNow, childPath)], { resolve: resolver })
  if (merge.kind !== 'note.edit') throw new Error('Expected parent edit')
  const merged = parseMoc(merge.after, path)
  expect(merged.chapters[0].entries.map(entry => entry.target)).toContain('notes/Newest')
  expect(merged.chapters[0].entries.map(entry => entry.target)).not.toContain('notes/New')
  expect(merged.chapters[0].entries.map(entry => entry.target)).not.toContain('notes/Note 1')
  expect(merged.chapters[1].entries.map(entry => entry.target)).toEqual(['New'])
  expect(formalEntries(merged)).toHaveLength(12)
})

it('does not overwrite a stale source or leave files behind when recording fails', async () => {
  const memory = createMemoryOpsIo({ [path]: original })
  const specs = planMocBranch(split, [file(original, path)], options)
  const store = createMemoryOpsStore()
  const service = createOpsService({ ...memory, store: { ...store, insert: async () => { throw new Error('DB offline') } } })
  const context = { actor: 'scott', batchId: 'failed' } as const
  memory.files[path] += '\nunsaved change'
  await expect(service.applyOps(specs, context, { guardedBatch: true })).rejects.toThrow('Note changed')
  expect(Object.keys(memory.files)).toEqual([path])
  memory.files[path] = original
  await expect(service.applyOps(specs, context, { guardedBatch: true })).rejects.toThrow('DB offline')
  expect(memory.files).toEqual({ [path]: original })
})

it('refreshes frozen status and the count without modifying user-authored text or undo versions', async () => {
  const { refreshSplitDisplay } = await import('./split-display')
  const { contentVersion } = await import('@/lib/ops/version')
  const resolver = (target: string) => target === 'MOCs/Growing' ? childPath : resolve(target)
  const [create, edit] = planMocBranch(split, [file(original, path)], { ...options, resolve: resolver })
  if (create.kind !== 'domain.create' || edit.kind !== 'note.edit') throw new Error('Expected split ops')
  const rootMoc = parseMoc(edit.after, path)
  const childNow = create.content
    .replace(/^- \[\[notes\/Note 0\]\].*$/m, row('New'))
    .replace(/^- \[\[notes\/Note 1\]\].*$/m, row('Replacement'))
  const allMocs = [rootMoc, parseMoc(childNow, childPath)]
  const notes = new Map([
    [resolve('Note 0'), { path: resolve('Note 0'), frontmatter: { status: 'superseded', superseded_by: '[[notes/Replacement]]' } }],
    [resolve('Note 1'), { path: resolve('Note 1'), frontmatter: { status: 'archived' } }],
    [resolve('Note 2'), { path: resolve('Note 2'), frontmatter: { outdated: true } }],
    [resolve('Note 3'), { path: resolve('Note 3'), frontmatter: {} }],
    [resolve('Replacement'), { path: resolve('Replacement'), frontmatter: { title: 'New version' } }],
  ])
  const updated = refreshSplitDisplay(edit.after, rootMoc, notes, resolver, allMocs)
  expect(updated).toContain('why Note 0 <!-- moc-split-status --> 已由 [[notes/Replacement]] 取代')
  expect(updated).toContain('why Note 1 <!-- moc-split-status --> 已封存')
  expect(updated).toContain('why Note 2 <!-- moc-split-status --> 過時')
  expect(updated).toContain('why Note 3 <!-- moc-split-status --> `Growing MOC`')
  expect(updated).toContain('分家後新增的 2 則不列在這裡')
  expect(updated).not.toContain('- [[New]]')
  expect(contentVersion(updated)).toBe(contentVersion(edit.after))
  expect(contentVersion(updated.replace('why Note 0', 'new relation'))).not.toBe(contentVersion(edit.after))
  expect(refreshSplitDisplay(updated, parseMoc(updated, path), notes, resolver, allMocs)).toBe(updated)
})

it('partitions a second-level chapter in page with the original C identifier and unchanged MOC membership', () => {
  const lower = file(original.replace('level: 1', `level: 2\nparent: ${root}`).replace(root, child), childPath)
  const second = [resolve(names[0]), resolve(names[1])]
  const [edit] = planMocBranch({
    kind: 'split-page', mocId: child, chapterId: chapter, expectedTitle: 'Growing',
    expectedEntries: names.map(resolve).sort(), titles: ['First question', 'Second question'], second,
  }, [lower], { resolve, identify: resolve, newChapterId: moved })
  if (edit.kind !== 'note.edit') throw new Error('Expected page edit')
  const revised = parseMoc(edit.after, childPath)
  expect(revised.chapters.map(item => [item.id, item.entries.length])).toEqual([[chapter, 10], [moved, 2]])
  expect(membershipsFromMocs([revised], resolve).byNote).toEqual(membershipsFromMocs([lower.moc], resolve).byNote)
  expect(edit.after).toContain('keep this')
})
