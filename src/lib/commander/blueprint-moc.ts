import { isExploring } from '@/lib/domain-page/moc-view'
import { parseV3Note } from '@/lib/v3-model/note'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { DEFAULT_DOMAIN_FOLDER, mocFileName, renderMocContent } from '@/lib/migration/domain-moc-migration'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import { formalEntries, parseMoc } from '@/lib/moc/parse'
import { entryTargetFor, rebuildFromMocs, skeletonPath, type MocIo } from '@/lib/moc/service'
import { normalizeDomainName } from './assign'
import { blueprintLine, type DomainBlueprint } from './blueprint'

export type ExplorationChange = 'promote' | 'withdraw'

export async function applyDomainBlueprint(blueprint: DomainBlueprint & { kind?: 'blueprint' }, io: MocIo) {
  const name = blueprintLine(blueprint.name, 80)
  const positioning = blueprintLine(blueprint.positioning).replace(/^#+\s*/, '')
  const chapters = blueprint.chapters.map(chapter => ({
    ...chapter, question: blueprintLine(chapter.question).replace(/^#+\s*/, ''),
  }))
  if (!name || !positioning || !chapters.length || chapters.some(chapter => !chapter.question || chapter.question === '尚未分章')
      || new Set(chapters.map(chapter => chapter.question)).size !== chapters.length) {
    throw new Error('The domain blueprint needs a positioning question and distinct, non-empty chapters')
  }
  const paths = io.paths()
  const mocs = (await io.listMocFiles()).map(file => parseMoc(file.raw, file.path))
  const existing = mocs.find(moc => moc.frontmatter.blueprint_ref === blueprint.id)
  const folder = (io.folder ?? DEFAULT_DOMAIN_FOLDER).replace(/^\/+|\/+$/g, '')
  const path = existing?.path ?? skeletonPath(folder, name, new Set(paths.map(path => path.toLowerCase())))
  const onDisk = await io.readFile(path)
  const written = onDisk === null ? undefined : parseMoc(onDisk, path)
  const notePaths = chapters.flatMap(chapter => chapter.notes.map(note => note.path))
  let id: string
  let content: string
  if (onDisk !== null && written?.id && written.frontmatter.blueprint_ref === blueprint.id) {
    id = written.id
    content = onDisk
  } else {
    if (written || mocs.some(moc => normalizeDomainName(moc.name) === normalizeDomainName(name))
        || [...(await io.domainNames()).values()].some(domain => normalizeDomainName(domain) === normalizeDomainName(name))) {
      throw new Error(`Domain already exists: ${name}`)
    }
    if (new Set(notePaths).size !== notePaths.length) throw new Error('A note can only be placed in one chapter')
    for (const notePath of notePaths) {
      const raw = await io.readFile(notePath)
      if (raw === null || parseV3Note(raw).fields.type !== 'knowledge' || !paths.includes(notePath) || /[\[\]|#^\r\n]/.test(entryTargetFor(notePath, paths))) {
        throw new Error(`Cannot include note: ${notePath}`)
      }
    }
    id = await io.newId('M')
    const skeleton = []
    for (const chapter of chapters) {
      skeleton.push({
        id: await io.newId('C'),
        question: chapter.question,
        entries: chapter.notes.map(note => ({ target: entryTargetFor(note.path, paths), relation: blueprintLine(note.relation) })),
      })
    }
    content = renderMocContent({
      name, fileName: mocFileName(name), mocId: id, level: 1, children: [], overview: '',
      chapterId: '', members: [], blueprint: { ref: blueprint.id, exploring: blueprint.kind === 'blueprint', positioning, chapters: skeleton },
    }).content
    const links = buildLinkLookup(paths)
    const members = formalEntries(parseMoc(content, path)).map(({ entry }) => resolveWikilinkTargetWithLookup(entry.target, links, path))
    if (members.length !== notePaths.length || members.some((member, index) => member !== notePaths[index])) {
      throw new Error('The MOC cannot resolve every note in the blueprint')
    }
    await io.createFile(path, content)
  }
  await io.recordMoc?.({ id, path, name: written?.name ?? name })
  const rebuild = await rebuildFromMocs(io, { extraNotes: notePaths, extraMocs: [path] })
  return { id, name, path, content, rebuild }
}

export function promoteExploration(raw: string): string | null {
  if (!isExploring(parseMoc(raw, '').status)) return null
  const { block, body } = splitFrontmatter(raw)
  const after = block.replace(/^(?:status|"status"|'status'):[ \t]*["']?(?:探索中|exploring)["']?[ \t]*(?:#[^\r\n]*)?(?:\r\n|\n|\r)/im, '')
  return after === block ? null : after + body
}

export async function changeExploration(
  io: MocIo,
  ref: { id: string, path: string },
  change: ExplorationChange,
) {
  const raw = await io.readFile(ref.path)
  const moc = raw === null ? null : parseMoc(raw, ref.path)
  if (raw === null || !moc?.isMoc || moc.id !== ref.id || !isExploring(moc.status)) throw new Error('This domain is no longer exploring')
  if (change === 'promote') {
    const after = promoteExploration(raw)
    if (!after || !(await io.commit([{ path: ref.path, before: raw, after }])).length) throw new Error('Could not update the domain status')
    return { rebuild: await rebuildFromMocs(io, { extraMocs: [ref.path] }), name: moc.name, before: raw, after }
  }
  if (!io.removeFile) throw new Error('Cannot withdraw this domain')
  // 先排除這個 MOC 試做歸屬重建。寫入若遇到衝突，保留 MOC 讓使用者能重試。
  const links = buildLinkLookup(io.paths())
  const members = formalEntries(moc).flatMap(({ entry }) => resolveWikilinkTargetWithLookup(entry.target, links, ref.path) ?? [])
  const rebuild = await rebuildFromMocs({
    ...io,
    listMocFiles: async extra => (await io.listMocFiles(extra)).filter(file => file.path !== ref.path),
  }, { retiredDomains: [moc.name], extraNotes: members })
  try {
    if (rebuild.skipped.length || await io.readFile(ref.path) !== raw) throw new Error('Could not update the domain memberships')
    await io.removeFile(ref.path)
  } catch (error) {
    await rebuildFromMocs(io, { extraMocs: [ref.path], extraNotes: members })
    throw error
  }
  return { rebuild, name: moc.name, before: raw, after: null }
}
