import { listDomains, removeDomainCache } from '@/db/v3-domains'
import { idExists, recordId, retireMocId } from '@/db/id-index'
import { askCollectModel } from '@/lib/collect/ai'
import { readNote, writeNote } from '@/lib/daily/note-io'
import type { ExploreRequest } from '@/lib/domain-page/explore'
import { mocFileName } from '@/lib/migration/domain-moc-migration'
import { createMocIo, serializeMocChange, settleMocRebuild } from '@/lib/moc/runtime'
import { snapshotInputs } from '@/lib/ops/refs'
import type { RecordInput } from '@/lib/ops/service'
import type { OpContext } from '@/lib/ops/types'
import { newId } from '@/lib/v3-model/identity'
import { parseMoc } from '@/lib/moc/parse'
import { membershipsFromMocs } from '@/lib/moc/membership'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import { knowledgeNotesFromIndex } from '@/lib/workbench/domain-cards'
import useSettingStore from '@/stores/setting'
import useVaultIndexStore from '@/stores/vault-index'
import { buildBlueprint, type BlueprintProposal, type DomainBlueprint } from './blueprint'
import { applyDomainBlueprint, changeExploration, type ExplorationChange } from './blueprint-moc'
import { useBlueprintStore } from './blueprint-store'

export async function draftExploration(request: ExploreRequest): Promise<BlueprintProposal> {
  const workspace = useSettingStore.getState().workspacePath
  const index = useVaultIndexStore.getState()
  if (index.status !== 'ready') throw new Error('Vault index is not ready')
  const [files, rows] = await Promise.all([createMocIo().listMocFiles(), listDomains()])
  const mocs = files.map(file => parseMoc(file.raw, file.path)).filter(moc => moc.isMoc)
  const links = buildLinkLookup([...index.notes.keys()])
  const { byNote: assigned } = membershipsFromMocs(mocs, (target, path) => resolveWikilinkTargetWithLookup(target, links, path ?? ''))
  const selected = new Set(request.origin === 'unassigned' ? request.notePaths : [])
  const notes = knowledgeNotesFromIndex(index.notes.values())
    .filter(note => selected.has(note.path) || (!assigned.has(note.path) && !note.domains.length))
    .map(note => {
      const summary = index.notes.get(note.path)?.frontmatter?.summary
      return { ...note, summary: typeof summary === 'string' ? summary : undefined }
    })
  const domains = [...mocs.map(moc => ({ name: moc.name, chapters: moc.chapters.map(chapter => chapter.title) }))]
  for (const row of rows) if (!domains.some(domain => domain.name === row.name)) domains.push({ name: row.name, chapters: [] })
  const proposal = await buildBlueprint(request, { notes, domains }, prompt => askCollectModel(prompt, undefined, { silent: true }), `blueprint:${crypto.randomUUID()}`, Date.now())
  if (useSettingStore.getState().workspacePath !== workspace) throw new Error('Workspace changed during exploration')
  useBlueprintStore.getState().put(workspace, proposal)
  return proposal
}

type BlueprintOptions = { learningProject?: boolean, ops?: OpContext }

export function createBlueprintMoc(blueprint: DomainBlueprint & { kind?: 'blueprint' }, options: BlueprintOptions = {}) {
  const workspace = useSettingStore.getState().workspacePath
  return serializeMocChange(async () => {
    if (useSettingStore.getState().workspacePath !== workspace || useVaultIndexStore.getState().status !== 'ready') {
      throw new Error('Vault index is not ready')
    }
    const result = await applyDomainBlueprint(blueprint, createMocIo())
    await settleMocRebuild(result.rebuild)
    const { id, name, path, content } = result
    const inputs: RecordInput[] = [{ spec: { kind: 'domain.create', mocId: id, name, path, content } }]
    if (options.learningProject) {
      inputs.push(...await createLearningProject(blueprint, { id, name, path }))
    }
    if (options.ops) {
      const { recordOps } = await import('@/lib/ops/runtime')
      await recordOps(inputs, options.ops)
    }
    return result
  })
}

async function createLearningProject(blueprint: DomainBlueprint, moc: { id: string, name: string, path: string }): Promise<RecordInput[]> {
  const title = `學習專案：${moc.name}`
  const path = `40 專案/${mocFileName(title)} ${moc.id}.md`
  const raw = await readNote(path)
  if (raw !== null) throw new Error(`Learning project already exists: ${path}`)
  const id = await newId('N', new Date(), { exists: idExists })
  const content = [
    '---', `id: ${id}`, 'type: project', 'status: valid', `title: ${JSON.stringify(title)}`, '---', '',
    `# ${title}`, '', `[[${moc.path.replace(/\.md$/i, '')}]]`, '', blueprint.positioning, '',
    ...blueprint.chapters.map(chapter => `- [ ] ${chapter.question}`), '',
  ].join('\n')
  await writeNote(path, content, { createNew: true })
  await recordId({ id, kind: 'N', path }).catch(error => console.warn('[explore] project index failed:', error))
  return snapshotInputs([{ path, before: null, after: content }])
}

export function updateExploration(ref: { id: string, path: string }, change: ExplorationChange) {
  const workspace = useSettingStore.getState().workspacePath
  return serializeMocChange(async () => {
    if (useSettingStore.getState().workspacePath !== workspace || useVaultIndexStore.getState().status !== 'ready') {
      throw new Error('Vault index is not ready')
    }
    const { rebuild, name, before, after } = await changeExploration(createMocIo(), ref, change)
    if (change === 'withdraw') {
      await Promise.all([removeDomainCache(ref.id), retireMocId(ref.id)])
    }
    await settleMocRebuild(rebuild)
    const inputs: RecordInput[] = after === null
      ? [{ spec: { kind: 'domain.remove', mocId: ref.id, name, path: ref.path, content: before } }]
      : snapshotInputs([{ path: ref.path, before, after }])
    const { recordOps } = await import('@/lib/ops/runtime')
    await recordOps(inputs, { actor: 'scott', actorId: 'scott' })
  })
}
