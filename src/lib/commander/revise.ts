import { describeDraftTarget, summarizeDraft } from '@/lib/agent-tasks/draft'
import { extractJson, isValidYmd } from '@/lib/collect/split'
import { toDateKey } from '@/lib/daily/format'
import type { FileChange, Proposal } from '@/lib/collect/types'
import type { CommanderDeps } from './types'

type RevisionDeps = Pick<CommanderDeps, 'ask' | 'roster' | 'agentPrompt' | 'now'>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function reviseFile(change: FileChange, patch: Record<string, unknown>): FileChange {
  const args = { ...change.args }
  const argsByTool: Record<string, readonly string[]> = {
    note_create_file: ['fileName', 'folderPath', 'content'],
    note_update_file: ['content'],
    note_rename_file: ['newName'],
    note_move_file: ['targetFolderPath'],
    note_copy_file: ['targetFolderPath', 'newName'],
    folder_create: ['folderPath'],
  }
  for (const key of argsByTool[change.toolName] ?? []) {
    const value = patch[key]
    if (typeof value === 'string' && (value.trim() || ['folderPath', 'targetFolderPath', 'content'].includes(key))) {
      args[key] = value
    }
  }
  if (JSON.stringify(args) === JSON.stringify(change.args)) return change
  const { path, targetPath, content } = describeDraftTarget(change.toolName, args)
  return { ...change, args, path, targetPath, content, summary: summarizeDraft(change.kind, path, targetPath, content, change.baseContent) }
}

function reviseFields(original: Proposal, patch: Record<string, unknown>): Proposal {
  const { title, body, due, time, tags } = patch
  const revised = { ...original }
  const compound = original.edits?.length || original.domainEdits?.length || original.memoryEdits?.length
  if (typeof title === 'string' && title.trim() && !original.slot && !original.change && !compound) revised.title = title.trim()
  if (typeof body === 'string' && original.kind === 'note' && !original.change && !compound) revised.body = body
  if (typeof due === 'string' && !original.slot && !original.change && !compound
    && (isValidYmd(due) || (due === '' && original.kind !== 'event'))) revised.due = due
  if (typeof time === 'string' && original.kind !== 'note'
    && (/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || (time === '' && original.kind === 'task'))) revised.time = time
  if (Array.isArray(tags) && tags.every(tag => typeof tag === 'string') && !original.slot && !original.change && !compound) revised.tags = tags

  if (original.change) {
    revised.change = reviseFile(original.change, record(patch.file))
    if (revised.change !== original.change) revised.title = revised.change.summary
  }
  if (original.edits && Array.isArray(patch.noteContents)) {
    const contents = patch.noteContents
    revised.edits = original.edits.map((edit, index) =>
      typeof contents[index] === 'string' ? { ...edit, content: contents[index] } : edit)
  }
  if (original.domainEdits && Array.isArray(patch.domainOverviews)) {
    const overviews = patch.domainOverviews
    revised.domainEdits = original.domainEdits.map((edit, index) =>
      typeof overviews[index] === 'string' ? { ...edit, overview: overviews[index] } : edit)
  }
  if (original.memoryEdits && Array.isArray(patch.workNoteContents)) {
    const contents = patch.workNoteContents
    revised.memoryEdits = original.memoryEdits.map((edit, index) =>
      edit.target !== 'context' && typeof contents[index] === 'string' ? { ...edit, content: contents[index] } : edit)
  }
  return revised
}

/** 指揮官只產出一則修訂提案。由程式保留來源、卡片標籤、原始檔案內容與可接受的操作。 */
export async function reviseProposal(
  input: { original: Proposal, key: string, conversationId: number, note: string, history: readonly { role: string, content: string }[] },
  deps: RevisionDeps,
): Promise<{ proposal: Proposal, commanderName: string }> {
  const commander = (await deps.roster()).find(agent => agent.role === 'commander' && agent.enabled)
  const instructions = await deps.agentPrompt(commander, 'commander')
  const prompt = [
    instructions,
    'Revise this pending proposal according to Scott’s note. This is a new proposal for approval, not authorization to write anything.',
    'Keep the original proposal type, source and labels. Use the language of the original. Do not invent facts.',
    'Return one JSON object with only changed fields. For a note or schedule use title, body, due (YYYY-MM-DD), time (HH:mm), tags (string array) as applicable.',
    'For file changes, use file with the changed arguments of the original tool (fileName, folderPath, content, newName, or targetFolderPath as applicable). Do not change the tool or the original file being read, changed or deleted.',
    'For edits, domainEdits and work_notes memoryEdits, use noteContents, domainOverviews or workNoteContents respectively: arrays in original order, with null at unchanged positions.',
    'If the request cannot be represented as a revision, return {}.',
    JSON.stringify({ today: toDateKey(deps.now?.() ?? new Date()), history: input.history, original: input.original, note: input.note }),
  ].join('\n\n')
  const revised = reviseFields(input.original, record(extractJson(await deps.ask(prompt))))
  if (JSON.stringify(revised) === JSON.stringify(input.original)) throw new Error('Commander did not produce a valid proposal revision')
  return {
    commanderName: commander?.name ?? '',
    proposal: {
      ...revised,
      conversationId: input.conversationId,
      previousProposalId: input.key,
      drafter: { role: 'commander', ...(commander ? { agentId: commander.id } : {}) },
    },
  }
}
