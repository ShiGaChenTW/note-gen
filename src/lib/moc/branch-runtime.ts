import { loadMocPositions, saveMocPositions } from '@/db/moc-positions'
import { refreshSplitDisplay } from './split-display'
import { commitNoteWrites } from '@/lib/daily/coordinated-write'
import { readNote } from '@/lib/daily/note-io'
import { DEFAULT_DOMAIN_FOLDER, mocFileName } from '@/lib/migration/domain-moc-migration'
import { parseV3Note } from '@/lib/v3-model/note'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import useVaultIndexStore from '@/stores/vault-index'
import { branchOrigin, branchPinPositions, planMocBranch, type MocBranchRequest } from './branching'
import { formalEntries, parseMoc, type ParsedMoc } from './parse'
import { observeMocPositions, type IsMocPinned, type MocPinPosition } from './positions'

let isPinned: IsMocPinned = () => false

/** ALMNC-69.11 於啟動時註冊。收到 M／C 與 N（舊資料以路徑識別）。 */
export function registerMocBranchPinCheck(check: IsMocPinned): void {
  isPinned = check
}

export function isMocBranchPinned(position: MocPinPosition): Promise<boolean> {
  return Promise.resolve(isPinned(position))
}

export function mocBranchLinks(vault = useVaultIndexStore.getState()) {
  const lookup = buildLinkLookup(vault.notes.keys())
  const resolve = (target: string, path?: string) => resolveWikilinkTargetWithLookup(target, lookup, path ?? '')
  const identify = (target: string, path?: string) => {
    const linked = resolve(target, path)
    if (!linked || vault.notes.get(linked)?.frontmatter?.kind === 'domain' || !/\.md$/i.test(linked)) return null
    const id = vault.notes.get(linked)?.frontmatter?.id
    return typeof id === 'string' ? id : linked
  }
  return { resolve, identify }
}

export async function trackMocPositions(mocs: readonly ParsedMoc[]): Promise<void> {
  const vault = useVaultIndexStore.getState()
  if (!vault.workspace) return
  const { identify } = mocBranchLinks(vault)
  const prior = await loadMocPositions(vault.workspace)
  const seen = new Set<string>()
  const now = Date.now()
  for (const moc of mocs) {
    if (!moc.id) continue
    seen.add(moc.id)
    const before = prior.get(moc.id) ?? null
    const after = observeMocPositions(moc, before, identify, now)
    if (JSON.stringify(before) !== JSON.stringify(after)) await saveMocPositions(vault.workspace, moc.id, after)
  }
  for (const id of prior.keys()) if (!seen.has(id)) await saveMocPositions(vault.workspace, id, null)
}

/** 更新有效 MOC 的系統標記，避免覆寫待整批檢查或同時編輯的原文。 */
export async function refreshMocSplitStatuses(mocs: readonly ParsedMoc[], overrides: ReadonlyMap<string, string | null>): Promise<void> {
  const vault = useVaultIndexStore.getState()
  const { resolve } = mocBranchLinks(vault)
  for (const moc of mocs) {
    if (!moc.path || overrides.has(moc.path) || !moc.chapters.some(chapter => chapter.grownInto)) continue
    const raw = await readNote(moc.path)
    if (useVaultIndexStore.getState().workspace !== vault.workspace) return
    if (raw === null) continue
    const actual = parseMoc(raw, moc.path)
    const after = refreshSplitDisplay(raw, actual, vault.notes, resolve, mocs)
    if (after !== raw) await commitNoteWrites([{ path: moc.path, before: raw, after }], { requireExisting: true })
  }
}

let queue: Promise<unknown> = Promise.resolve()

/** Scott 可直接執行。夥伴只能由工作台帶入已接受的提案及發起者。 */
export function applyMocBranch(request: MocBranchRequest, accepted?: import('@/lib/ops/types').OpContext) {
  const start = useVaultIndexStore.getState().workspace
  const next = queue.then(async () => {
    if (accepted && !accepted.proposalId) throw new Error('MOC proposal has not been accepted')
    const vault = useVaultIndexStore.getState()
    if (!start || vault.workspace !== start || vault.status !== 'ready') throw new Error('Vault changed or is not ready')
    const [{ createMocIo }, ops, guard, { runMocReconcile }] = await Promise.all([
      import('./runtime'), import('@/lib/ops/runtime'), import('@/lib/local-mcp/workspace-guard'), import('./reconcile-runtime'),
    ])
    const release = guard.beginLocalMcpWorkspaceWrite()
    try {
      // 先處理尚未比對的 Obsidian 編輯，避免把整批分家誤當成手動移除。
      await runMocReconcile()
      if (useVaultIndexStore.getState().workspace !== start) throw new Error('Vault changed before planning')
      const io = createMocIo()
      const files = (await io.listMocFiles()).map(file => ({ ...file, moc: parseMoc(file.raw, file.path) }))
      const source = files.find(file => file.moc.id === request.mocId)
      if (!source) throw new Error('MOC is missing')
      const { resolve, identify } = mocBranchLinks(vault)
      const origin = request.kind === 'merge' ? branchOrigin(source.moc) : null
      if (accepted) {
        const pinned = await Promise.all(branchPinPositions(source.moc, request, identify).map(isMocBranchPinned))
        if (pinned.some(Boolean)) throw new Error('A Scott-designated position would change')
      }
      let destination
      let newChapterId
      if (request.kind !== 'merge') {
        const chapter = source.moc.chapters.find(item => item.id === request.chapterId)
        if (!chapter) throw new Error('MOC chapter is missing')
        if (request.expectedTitle && chapter.title !== request.expectedTitle) throw new Error('The proposed chapter changed')
        if (request.expectedEntries) {
          const current = Object.keys(observeMocPositions(source.moc, null, identify, 0)[request.chapterId].entries).sort()
          if (JSON.stringify(current) !== JSON.stringify(request.expectedEntries)) throw new Error('The chapter membership changed')
        }
        if (request.kind === 'split-page') newChapterId = await io.newId('C')
        else {
          const fileName = mocFileName(chapter.title)
          const path = `${DEFAULT_DOMAIN_FOLDER}/${fileName}.md`
          if (await readNote(path) !== null) throw new Error('MOC destination already exists')
          destination = { id: await io.newId('M'), path, chapterId: await io.newId('C') }
        }
      }
      const noteDomains = new Map<string, string[]>()
      const domainNames = await io.domainNames()
      for (const { entry, chapter } of formalEntries(source.moc)) {
        if (request.kind !== 'merge' && chapter.id !== request.chapterId) continue
        const path = resolve(entry.target, source.path)
        if (!path || !identify(entry.target, source.path)) throw new Error(`Unresolved MOC entry: ${entry.target}`)
        if (noteDomains.has(path)) continue
        const raw = await readNote(path)
        if (raw === null) throw new Error(`Missing note: ${path}`)
        noteDomains.set(path, parseV3Note(raw).fields.domains.map(name => domainNames.get(name) ?? name))
      }
      const specs = planMocBranch(request, files, { resolve, identify, destination, newChapterId, noteDomains })
      if (useVaultIndexStore.getState().workspace !== start) throw new Error('Vault changed before writing MOCs')
      const records = await ops.applyOps(specs, accepted
        ? { ...accepted, batchId: accepted.batchId ?? ops.newBatchId() }
        : { actor: 'scott', actorId: 'scott', batchId: ops.newBatchId() }, { guardedBatch: true })
      const first = specs[0]
      const id = first.kind === 'domain.create' ? first.mocId : origin?.mocId ?? request.mocId
      return { path: first.kind === 'domain.create' || first.kind === 'note.edit' ? first.path : source.path, mocId: id, records }
    } finally {
      release()
    }
  })
  queue = next.catch(() => undefined)
  return next
}
