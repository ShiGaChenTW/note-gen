// Fork（#30）：草稿的純函式規則。不碰檔案系統，方便測試。
import type { AgentTask, AgentTaskStatus, DraftChange, DraftKind } from './types'

/** 背景任務可以改動 vault 的工具，以及它們對應的草稿種類。 */
export const DRAFT_TOOL_KINDS: Record<string, DraftKind> = {
  note_create_file: 'create',
  note_update_file: 'update',
  note_delete_file: 'delete',
  note_rename_file: 'move',
  note_move_file: 'move',
  note_copy_file: 'copy',
  folder_create: 'folder',
}

/** 背景任務不提供的唯讀工具：會打開編輯器或需要使用者在場。 */
export const BACKGROUND_EXCLUDED_TOOLS = new Set(['note_open_file', 'ask_user_question'])

/** 背景任務不提供的工具類別：依賴目前畫面上的編輯器、畫布、附件或對話。 */
export const BACKGROUND_EXCLUDED_CATEGORIES = new Set(['editor', 'canvas', 'attachment', 'image', 'chat'])

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function joinPath(folder: string, name: string) {
  const cleanFolder = folder.replace(/^\/+|\/+$/g, '')
  return cleanFolder ? `${cleanFolder}/${name}` : name
}

function baseName(path: string) {
  return path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
}

function dirName(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** 從工具參數推出受影響的路徑與目的地。 */
export function describeDraftTarget(toolName: string, args: Record<string, unknown>): { path: string; targetPath?: string; content?: string } {
  switch (toolName) {
    case 'note_create_file':
      return { path: joinPath(str(args.folderPath), str(args.fileName)), content: typeof args.content === 'string' ? args.content : '' }
    case 'note_update_file':
      return { path: str(args.filePath), content: typeof args.content === 'string' ? args.content : '' }
    case 'note_delete_file':
      return { path: str(args.filePath) }
    case 'note_rename_file': {
      const path = str(args.filePath)
      return { path, targetPath: joinPath(dirName(path), str(args.newName)) }
    }
    case 'note_move_file': {
      const path = str(args.filePath)
      return { path, targetPath: joinPath(str(args.targetFolderPath), baseName(path)) }
    }
    case 'note_copy_file': {
      const path = str(args.filePath)
      const folder = args.targetFolderPath === undefined ? dirName(path) : str(args.targetFolderPath)
      return { path, targetPath: joinPath(folder, str(args.newName) || baseName(path)) }
    }
    case 'folder_create':
      return { path: str(args.folderPath) }
    default:
      return { path: '' }
  }
}

function lineCount(text: string | undefined) {
  return text ? text.split('\n').length : 0
}

export function summarizeDraft(kind: DraftKind, path: string, targetPath: string | undefined, content: string | undefined, baseContent: string | null): string {
  switch (kind) {
    case 'create': return `新增 ${path}（${lineCount(content)} 行）`
    case 'update': return `修改 ${path}（${lineCount(baseContent ?? '')} → ${lineCount(content)} 行）`
    case 'delete': return `刪除 ${path}`
    case 'move': return `搬移 ${path} → ${targetPath}`
    case 'copy': return `複製 ${path} → ${targetPath}`
    case 'folder': return `新增資料夾 ${path}`
  }
}

/**
 * 同一路徑的草稿合併成一筆：新增後再修改 → 一筆新增；修改兩次 → 一筆修改；
 * 新增後又刪除 → 兩筆都不留。這樣審核時每個檔案只看一次，衝突判斷也只看磁碟上的原內容。
 */
export function mergeDraft(drafts: DraftChange[], next: DraftChange): DraftChange[] {
  const index = drafts.findIndex(draft => draft.state === 'pending' && draft.path === next.path && (draft.kind === 'create' || draft.kind === 'update'))
  if (index === -1) return [...drafts, next]
  const prior = drafts[index]
  if (next.kind === 'update') {
    const merged: DraftChange = {
      ...prior,
      content: next.content,
      args: { ...prior.args, content: next.content },
      summary: summarizeDraft(prior.kind, prior.path, prior.targetPath, next.content, prior.baseContent),
    }
    return drafts.map((draft, i) => (i === index ? merged : draft))
  }
  if (next.kind === 'delete') {
    if (prior.kind === 'create') return drafts.filter((_, i) => i !== index)
    return drafts.map((draft, i) => (i === index ? { ...next, baseContent: prior.baseContent } : draft))
  }
  return [...drafts, next]
}

/** 搬移、刪除一律逐條確認；有衝突的也是。 */
export function requiresIndividualReview(draft: DraftChange, conflict: boolean): boolean {
  return draft.kind === 'delete' || draft.kind === 'move' || conflict
}

/**
 * 衝突：建立草稿後，vault 裡的檔案又被改過（例如手機同步進來）。
 * currentContent 為 null 表示目前檔案不存在。
 */
export function hasConflict(draft: DraftChange, currentContent: string | null): boolean {
  if (draft.kind === 'folder') return false
  if (draft.kind === 'create') return currentContent !== null && currentContent !== draft.content
  return currentContent !== draft.baseContent
}

/** 任務執行中讀檔時，先看草稿：同一路徑最後一筆草稿的結果才是任務「看到」的內容。 */
export function readThroughDrafts(drafts: DraftChange[], path: string): { found: boolean; content: string | null } {
  let found = false
  let content: string | null = null
  for (const draft of drafts) {
    if (draft.state !== 'pending') continue
    if ((draft.kind === 'create' || draft.kind === 'update') && draft.path === path) {
      found = true
      content = draft.content ?? ''
    } else if ((draft.kind === 'delete' || draft.kind === 'move') && draft.path === path) {
      found = true
      content = null
    }
  }
  return { found, content }
}

/** 審核結束後的任務狀態：還有沒處理的草稿就繼續等你。 */
export function statusAfterReview(task: AgentTask): AgentTaskStatus {
  return task.drafts.some(draft => draft.state === 'pending') ? 'awaiting_review' : 'completed'
}

/** 任務跑完時：有草稿就等你審，沒有就直接完成。 */
export function statusAfterRun(drafts: DraftChange[]): AgentTaskStatus {
  return drafts.some(draft => draft.state === 'pending') ? 'awaiting_review' : 'completed'
}

/** 依並行上限，從排隊中挑出可以開始的任務（先進先出）。 */
export function pickRunnable(tasks: AgentTask[], limit: number): AgentTask[] {
  const running = tasks.filter(task => task.status === 'running').length
  const slots = Math.max(0, limit - running)
  return tasks
    .filter(task => task.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, slots)
}

/** app 重開時：上次還在跑或排隊的任務都算「沒做完」，草稿保留。 */
export function markInterrupted(task: AgentTask, now: number): AgentTask {
  if (task.status !== 'running' && task.status !== 'queued') return task
  return { ...task, status: 'interrupted', updatedAt: now }
}

/** 「繼續」時附給模型的說明，避免重做已經存成草稿的修改。 */
export function buildResumeNote(drafts: DraftChange[]): string {
  const pending = drafts.filter(draft => draft.state === 'pending')
  if (!pending.length) return ''
  return [
    '這個任務先前中斷過。以下修改已經存成草稿，不要重複做：',
    ...pending.map(draft => `- ${draft.summary}`),
  ].join('\n')
}
