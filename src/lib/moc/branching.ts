import { MOC_HEADINGS, renderMocContent } from '@/lib/migration/domain-moc-migration'
import type { NoteEditOp, OpSpec } from '@/lib/ops/types'
import { isId } from '@/lib/v3-model/identity'
import { formalEntries, isUnsortedTitle, type MocChapter, type MocEntry, type ParsedMoc } from './parse'
import type { ResolveTarget } from './membership'
import type { MocPinPosition } from './positions'
import { isLegacySplitCountLine, isSplitCountLine, withSplitStatus } from './split-status'

export type MocBranchRequest =
  | { kind: 'split', mocId: string, chapterId: string, expectedTitle?: string, expectedEntries?: string[] }
  | { kind: 'split-page', mocId: string, chapterId: string, expectedTitle: string, expectedEntries: string[], titles: [string, string], second: string[] }
  | { kind: 'merge', mocId: string }

export interface BranchFile { path: string, raw: string, moc: ParsedMoc }
interface BranchOptions {
  resolve: ResolveTarget
  destination?: { id: string, path: string, chapterId: string }
  newChapterId?: string
  identify?: ResolveTarget
  noteDomains?: ReadonlyMap<string, readonly string[]>
}

export function branchOrigin(moc: ParsedMoc) {
  const { split_from, split_chapter } = moc.frontmatter
  if (typeof split_from !== 'string' || !isId(split_from, 'M') || typeof split_chapter !== 'string' || !isId(split_chapter, 'C')) return null
  return { mocId: split_from, chapterId: split_chapter }
}

export function branchExpertSourceIds(id: string, mocs: readonly ParsedMoc[]): string[] {
  const byId = new Map(mocs.map(moc => [moc.id, moc]))
  const chain = [id]
  let next = byId.get(id)
  while (next) {
    const origin = branchOrigin(next)
    if (!origin || chain.includes(origin.mocId)) break
    chain.push(origin.mocId)
    next = byId.get(origin.mocId)
  }
  return chain
}

export function branchPinPositions(moc: ParsedMoc, request: MocBranchRequest, identify: ResolveTarget): MocPinPosition[] {
  const positions = new Map<string, MocPinPosition>()
  const add = (position: MocPinPosition) => positions.set(JSON.stringify(position), position)
  const origin = request.kind === 'merge' ? branchOrigin(moc) : null
  if (origin) add(origin)
  if (request.kind !== 'merge') add({ mocId: request.mocId, chapterId: request.chapterId })
  for (const { entry, chapter } of formalEntries(moc)) {
    if (!chapter.id || (request.kind !== 'merge' && chapter.id !== request.chapterId)) continue
    const note = identify(entry.target, moc.path) ?? undefined
    add({ mocId: request.mocId, chapterId: chapter.id })
    if (!note) continue
    add({ mocId: request.mocId, chapterId: chapter.id, note })
    if (origin) add({ ...origin, note })
  }
  return [...positions.values()]
}

function entriesIn(file: BranchFile, resolve: ResolveTarget, chapter?: MocChapter, skipUnresolved = false) {
  const entries = new Map<string, MocEntry>()
  for (const item of formalEntries(file.moc)) {
    if (chapter && item.chapter !== chapter) continue
    const path = resolve(item.entry.target, file.path)
    if (!path) {
      if (skipUnresolved) continue
      throw new Error(`Unresolved MOC entry: ${item.entry.target}`)
    }
    if (!entries.has(path)) entries.set(path, item.entry)
  }
  return entries
}

function noteLine(entry: MocEntry, path: string) {
  const link = path.replace(/\.md$/i, '')
  return entry.raw.replace(/\[\[[^\]|#]+/, () => `[[${link}`)
}

function edit(file: BranchFile, after: string, from: string, to: string, moved: Iterable<string>, options: BranchOptions): NoteEditOp {
  const domainOrder = [...moved].flatMap(path => {
    const before = options.noteDomains?.get(path)
    if (!before?.includes(from)) return []
    let after: string[]
    if (before[0] === from) after = [to, ...before.filter(name => name !== from && name !== to)]
    else after = before.filter(name => name !== from)
    return [{ path, before: [...before], after }]
  })
  return { kind: 'note.edit', path: file.path, noteId: file.moc.id, title: file.moc.name, before: file.raw, after, domainOrder }
}

/** 分家／併回的快照以編號定位，後續由 ops 在同一批比對版本並寫入。 */
export function planMocBranch(request: MocBranchRequest, files: readonly BranchFile[], options: BranchOptions): OpSpec[] {
  const source = files.find(file => file.moc.id === request.mocId)
  if (!source) throw new Error('MOC is missing')
  const { moc } = source

  if (request.kind === 'split-page') {
    const chapter = moc.chapters.find(item => item.id === request.chapterId && !item.grownInto)
    const first = request.titles[0]
    const second = request.titles[1]
    const safe = (title: string) => typeof title === 'string' && title.trim() === title && title && !/[\r\n]|→\s*已長成/.test(title) && !isUnsortedTitle(title)
      && !moc.chapters.some(item => item !== chapter && item.title === title)
    if (!moc.parent || !chapter || !options.newChapterId || !options.identify || !safe(first) || !safe(second) || first === second) {
      throw new Error('Invalid chapter partition')
    }
    const wanted = new Set(request.second)
    const entries = [...entriesIn(source, options.resolve, chapter).values()]
    const identify = options.identify
    const toMove = (entry: MocEntry) => !entry.reference && wanted.has(identify(entry.target, source.path) ?? '')
    const selected = entries.filter(toMove)
    if (!selected.length || selected.length !== wanted.size || selected.length >= entries.length) throw new Error('Invalid chapter partition')
    const moved = new Set(chapter.entries.filter(toMove).map(entry => entry.line))
    const lines = source.raw.split(moc.eol)
    lines[chapter.line] = `### ${first}`
    let end = chapter.endLine
    while (end > chapter.line + 1 && !lines[end - 1].trim()) end--
    lines.splice(end, 0, '', `### ${second}`, `<!-- ${options.newChapterId} -->`, ...selected.map(entry => entry.raw))
    const after = lines.filter((_, index) => !moved.has(index)).join(moc.eol)
    return [{ kind: 'note.edit', path: source.path, noteId: moc.id, title: moc.name, before: source.raw, after }]
  }

  if (request.kind === 'split') {
    const chapter = moc.chapters.find(item => item.id === request.chapterId && !item.grownInto)
    const destination = options.destination
    const parent = moc.parent ? files.find(file => file.moc.id === moc.parent) : source
    if (!chapter || !destination || !parent?.moc.id || parent.moc.parent || (parent.moc.level ?? 1) !== 1
      || (moc.level !== undefined && moc.level !== (moc.parent ? 2 : 1))) throw new Error('Invalid MOC placement or chapter')
    if (/[\[\]#|\x60]/.test(chapter.title) || isUnsortedTitle(chapter.title)
      || files.some(file => file.path.toLowerCase() === destination.path.toLowerCase() || file.moc.name.toLowerCase() === chapter.title.toLowerCase())) {
      throw new Error('MOC name is unavailable')
    }
    const moved = entriesIn(source, options.resolve, chapter)
    if (!moved.size) throw new Error('The chapter has no formal entries')

    const name = chapter.title
    const link = destination.path.replace(/\.md$/i, '')
    const frozen = source.raw.split(moc.eol)
    frozen[chapter.line] = `### ${chapter.title} → 已長成 [[${link}|${name}]] MOC`
    for (const entry of chapter.entries) {
      if (!entry.reference) frozen[entry.line] = withSplitStatus(entry.raw, `\`${name} MOC\``)
    }
    const skeleton = renderMocContent({
      name, fileName: destination.path.split('/').pop()!.replace(/\.md$/i, ''), mocId: destination.id, level: 2,
      parent: { mocId: parent.moc.id, name: parent.moc.name, fileName: parent.path.replace(/\.md$/i, '') },
      children: [], overview: name, chapterId: '', members: [],
    }).content
    const content = skeleton
      .replace('\nkind: domain\n', `\nkind: domain\nsplit_from: ${request.mocId}\nsplit_chapter: ${request.chapterId}\n`)
      .replace(`${MOC_HEADINGS.chapters}\n\n<!-- 還沒有收錄的筆記。 -->`, [
        MOC_HEADINGS.chapters, '', `### ${chapter.title}`, `<!-- ${destination.chapterId} -->`, ...[...moved].map(([path, entry]) => noteLine(entry, path)),
      ].join('\n'))
    return [
      { kind: 'domain.create', mocId: destination.id, name, path: destination.path, content },
      edit(source, frozen.join(moc.eol), moc.name, name, moved.keys(), options),
    ]
  }

  const origin = branchOrigin(moc)
  const parent = files.find(file => file.moc.id === origin?.mocId)
  const chapter = parent?.moc.chapters.find(item => item.id === origin?.chapterId && item.grownInto)
  if (!origin || !parent || !chapter || files.some(file => file.moc.parent === moc.id || branchOrigin(file.moc)?.mocId === moc.id)) {
    throw new Error('The original chapter is unavailable or this MOC has active branches')
  }
  const landing = options.resolve(chapter.grownInto!, parent.path)
  if (landing && files.some(file => file.path === landing && file !== source)) throw new Error('The split link points to another MOC')
  const moved = entriesIn(source, options.resolve)
  const existing = entriesIn(parent, options.resolve, undefined, true)
  const frozen = new Map(chapter.entries.map(entry => [options.resolve(entry.target, parent.path), entry]))
  const lines = parent.raw.split(parent.moc.eol)
  lines[chapter.line] = `### ${chapter.title}`
  const rowNumbers = new Set(chapter.entries.map(entry => entry.line))
  for (let index = chapter.line + 1; index < chapter.endLine; index++) {
    if (isSplitCountLine(lines[index]) || isLegacySplitCountLine(lines[index])) rowNumbers.add(index)
  }
  const insertion = chapter.entries[0]?.line ?? (chapter.commentLine ?? chapter.line) + 1
  const restored = [...moved].flatMap(([path, entry]) => {
    if (existing.has(path)) return []
    const oldEntry = frozen.get(path)
    const line = noteLine(entry, path)
    return [entry.relation ? line : `${line.trimEnd()} ── ${oldEntry?.relation ?? ''}`]
  })
  const after = lines.flatMap((line, index) => [...(index === insertion ? restored : []), ...(rowNumbers.has(index) ? [] : [line])]).join(parent.moc.eol)
  return [
    edit(parent, after, moc.name, parent.moc.name, moved.keys(), options),
    { kind: 'domain.remove', mocId: moc.id, name: moc.name, path: source.path, content: source.raw },
  ]
}
