// Fork（almanac ALMNC-54.12）：接受清理提案（以及確認、記憶稽核提案）時的寫入。
// 原則「不偷偷覆寫」：先逐一比對每則筆記、領域總覽、記憶是不是還是提案當下的內容；只要有一處被改過就整則不寫（CONFLICT），
// 交回工作台讓 Scott 再次討論。寫到一半失敗時，已寫的盡量還原。純邏輯，I/O 由外面注入（預設實作在 apply-io.ts）。
import type { FileSnapshot } from '@/lib/ops/version'
import { applyMocChange } from '@/lib/moc/edit'
import type { DomainEdit, MemoryEdit, NoteEdit, Proposal } from '@/lib/collect/types'

type ContextShape = Extract<MemoryEdit, { target: 'context' }>['context']
type WorkNotesAgent = Extract<MemoryEdit, { target: 'work_notes' | 'rules' }>['agent']

export interface EditIo {
  readNote: (path: string) => Promise<string | null>
  writeNote: (path: string, content: string) => Promise<void>
  rewriteNote?: (path: string, before: string, after: string, rebase?: (latest: string) => string | null) => Promise<void>
  /** 還原時刪掉這次新增的筆記；沒有就留著（內容是新的筆記，不會蓋掉任何東西）。 */
  removeNote?: (path: string) => Promise<void>
  getDomainOverview?: (domainId: string) => Promise<string | undefined>
  setDomainOverview?: (domainId: string, overview: string) => Promise<void>
  getWorkNotes?: (agent: WorkNotesAgent) => Promise<string>
  setWorkNotes?: (agent: WorkNotesAgent, content: string) => Promise<void>
  getRules?: (agent: WorkNotesAgent) => Promise<string>
  setRules?: (agent: WorkNotesAgent, content: string) => Promise<void>
  getContext?: () => Promise<ContextShape>
  setContext?: (context: ContextShape) => Promise<void>
}

/** 有任何一處在提案之後被改過（conflict），或缺少寫入的工具。 */
export class EditsNotApplied extends Error {
  constructor(readonly conflict: boolean, readonly targets: string[], detail?: string) {
    super(detail ?? (conflict ? 'CONFLICT' : 'edits not applied'))
    this.name = 'EditsNotApplied'
  }
}

export function hasEdits(proposal: Pick<Proposal, 'edits' | 'domainEdits' | 'memoryEdits'>): boolean {
  return Boolean(proposal.edits?.length || proposal.domainEdits?.length || proposal.memoryEdits?.length)
}

function sameContext(a: ContextShape, b: ContextShape): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface Step {
  target: string
  write: () => Promise<void>
  undo: () => Promise<void>
  snapshot?: () => FileSnapshot
}

async function planNote(edit: NoteEdit, io: EditIo, conflicts: string[]): Promise<Step | undefined> {
  const current = await io.readNote(edit.path)
  const { baseContent, moc } = edit
  const rebase = moc && baseContent !== null
    ? (latest: string) => applyMocChange(baseContent, latest, moc.id, moc.change)
    : undefined
  const content = rebase && current !== null ? rebase(current) : current === edit.baseContent && !edit.moc ? edit.content : null
  if (content === null) {
    conflicts.push(edit.path)
    return undefined
  }
  let previous = current
  let written = content
  return {
    target: edit.path,
    snapshot: () => ({ path: edit.path, before: previous, after: written }),
    write: () => current !== null && io.rewriteNote
      ? io.rewriteNote(edit.path, current, content, rebase && (latest => {
        const rebased = rebase(latest)
        if (rebased !== null) {
          previous = latest
          written = rebased
        }
        return rebased
      }))
      : io.writeNote(edit.path, content),
    undo: async () => {
      if (previous === null) await io.removeNote?.(edit.path)
      else if (io.rewriteNote) await io.rewriteNote(edit.path, written, previous)
      else await io.writeNote(edit.path, previous)
    },
  }
}

async function planDomain(edit: DomainEdit, io: EditIo, conflicts: string[]): Promise<Step | undefined> {
  if (!io.getDomainOverview || !io.setDomainOverview) throw new EditsNotApplied(false, [`domain:${edit.domainId}`], 'domain writer unavailable')
  const current = await io.getDomainOverview(edit.domainId)
  if (current === undefined || current !== edit.baseOverview) {
    conflicts.push(`domain:${edit.domainId}`)
    return undefined
  }
  const set = io.setDomainOverview
  return { target: `domain:${edit.domainId}`, write: () => set(edit.domainId, edit.overview), undo: () => set(edit.domainId, current) }
}

async function planMemory(edit: MemoryEdit, io: EditIo, conflicts: string[]): Promise<Step | undefined> {
  if (edit.target !== 'context') {
    const get = edit.target === 'rules' ? io.getRules : io.getWorkNotes
    const set = edit.target === 'rules' ? io.setRules : io.setWorkNotes
    if (!get || !set) throw new EditsNotApplied(false, [`memory:${edit.agent.id}`], 'memory writer unavailable')
    const current = await get(edit.agent)
    if (current !== edit.baseContent) {
      conflicts.push(`memory:${edit.agent.id}`)
      return undefined
    }
    return { target: `memory:${edit.agent.id}`, write: () => set(edit.agent, edit.content), undo: () => set(edit.agent, current) }
  }
  if (!io.getContext || !io.setContext) throw new EditsNotApplied(false, ['memory:context'], 'memory writer unavailable')
  const current = await io.getContext()
  if (!sameContext(current, edit.baseContext)) {
    conflicts.push('memory:context')
    return undefined
  }
  const set = io.setContext
  return { target: 'memory:context', write: () => set(edit.context), undo: () => set(current) }
}

/**
 * 寫入提案裡所有的變更。全部比對通過才開始寫；寫到一半失敗會把已寫的還原再丟出錯誤。
 * 回傳寫了哪些對象（筆記路徑、domain:<id>、memory:<id>）。
 */
export async function applyEdits(proposal: Pick<Proposal, 'edits' | 'domainEdits' | 'memoryEdits'>, io: EditIo, onWritten?: (changes: FileSnapshot[]) => void): Promise<string[]> {
  const conflicts: string[] = []
  const steps: Step[] = []
  // 同一則筆記在一則提案裡只會出現一次（plan.ts 已合併），這裡仍照順序處理。
  for (const edit of proposal.edits ?? []) {
    const step = await planNote(edit, io, conflicts)
    if (step) steps.push(step)
  }
  for (const edit of proposal.domainEdits ?? []) {
    const step = await planDomain(edit, io, conflicts)
    if (step) steps.push(step)
  }
  for (const edit of proposal.memoryEdits ?? []) {
    const step = await planMemory(edit, io, conflicts)
    if (step) steps.push(step)
  }
  if (conflicts.length) throw new EditsNotApplied(true, conflicts)

  const done: Step[] = []
  try {
    for (const step of steps) {
      await step.write()
      done.push(step)
    }
  } catch (error) {
    for (const step of done.reverse()) await step.undo().catch(() => undefined)
    if (error instanceof EditsNotApplied) throw error
    throw new EditsNotApplied(false, steps.map(step => step.target), error instanceof Error ? error.message : String(error))
  }
  onWritten?.(done.flatMap(step => step.snapshot?.() ?? []))
  return steps.map(step => step.target)
}
