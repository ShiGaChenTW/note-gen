// Fork（almanac ALMNC-54.21）：新增筆記的提案——卡片上顯示建議標題和建議存放位置，接受前可以直接改（定案文件第四節 4.23）。
// 兩種新增筆記的提案：
// - 收集／指揮官分析出的筆記（kind: note）：標題就是筆記標題（也決定檔名），位置預設收件資料夾，改了記在 proposal.folder；
// - 右側欄指揮官的 propose_note_create（change.kind: create）：標題是檔名、位置是 folderPath，改了直接改工具參數與路徑。
// 純函式；改好的提案存回收集 store（stores/collect.ts retarget），接受時照常寫入，寫的就是改過的值。
import type { Proposal } from '@/lib/collect/types'

export interface NewNoteTarget {
  title: string
  /** 筆記庫裡的資料夾，'' 是最上層。 */
  folder: string
}

export type NewNoteEditError = 'TITLE_REQUIRED' | 'TITLE_INVALID' | 'FOLDER_INVALID'

/** 檔名拆成名稱與副檔名（「OEE.md」→「OEE」「.md」）。 */
function splitName(path: string): { folder: string, name: string, ext: string } {
  const index = path.lastIndexOf('/')
  const base = index >= 0 ? path.slice(index + 1) : path
  // 只認文字筆記的副檔名，標題裡的點（「v1.2 規劃」）不算。
  const ext = base.match(/\.(?:md|markdown|txt)$/i)?.[0] ?? ''
  return { folder: index > 0 ? path.slice(0, index) : '', name: ext ? base.slice(0, -ext.length) : base, ext }
}

/** 資料夾：去掉前後空白與斜線、合併重複斜線；「.」是最上層。 */
export function normalizeFolder(folder: string): string {
  const clean = folder.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '')
  return clean === '.' ? '' : clean
}

/** 這則提案是不是可以改標題和位置的新增筆記；是的話回傳目前的值。 */
export function newNoteTarget(proposal: Proposal, inboxFolder: string): NewNoteTarget | null {
  if (proposal.change) {
    if (proposal.change.kind !== 'create' || proposal.change.toolName !== 'note_create_file') return null
    // 路徑是工具參數合成的（folderPath＋fileName，fileName 也可能自己帶資料夾），以它為準。
    const { folder, name } = splitName(proposal.change.path)
    return { title: name, folder: normalizeFolder(folder) }
  }
  if (proposal.kind !== 'note' || proposal.slot || proposal.edits?.length || proposal.domainEdits?.length || proposal.memoryEdits?.length || proposal.review) return null
  return { title: proposal.title, folder: normalizeFolder(proposal.folder ?? inboxFolder) }
}

/** 檢查改好的值：標題不能空白、不能含斜線；位置不能往上跳（..）。 */
export function checkNewNoteEdit(edit: NewNoteTarget): { ok: true, value: NewNoteTarget } | { ok: false, error: NewNoteEditError } {
  const title = edit.title.replace(/\s+/g, ' ').trim()
  if (!title) return { ok: false, error: 'TITLE_REQUIRED' }
  if (/[\\/]/.test(title)) return { ok: false, error: 'TITLE_INVALID' }
  const folder = normalizeFolder(edit.folder)
  if (folder.split('/').some(part => part === '..' || part === '.')) return { ok: false, error: 'FOLDER_INVALID' }
  return { ok: true, value: { title, folder } }
}

/** 照改好的值換掉提案的標題與位置（值要先過 checkNewNoteEdit）。不是新增筆記的提案原樣回傳。 */
export function retargetNewNote(proposal: Proposal, edit: NewNoteTarget, inboxFolder: string): Proposal {
  const current = newNoteTarget(proposal, inboxFolder)
  if (!current) return proposal
  const checked = checkNewNoteEdit(edit)
  if (!checked.ok) return proposal
  const { title, folder } = checked.value
  if (title === current.title && folder === current.folder) return proposal
  const change = proposal.change
  // ALMNC-69.2：第一次改時記下原建議，之後再改不覆蓋。
  const suggested = proposal.suggested ?? (change
    ? { title: current.title, folder: current.folder }
    : { title: proposal.title, ...(proposal.folder !== undefined ? { folder: proposal.folder } : {}) })
  if (change) {
    // 副檔名照原本的；提案的 title 是變更摘要，不動。
    const fileName = `${title}${splitName(change.path).ext || '.md'}`
    return { ...proposal, suggested, change: { ...change, args: { ...change.args, fileName, folderPath: folder }, path: folder ? `${folder}/${fileName}` : fileName } }
  }
  // 位置沒改就不記 folder：接受時照當下的收件資料夾（卡片顯示時設定可能還沒讀好）。
  return { ...proposal, suggested, title, ...(folder !== current.folder ? { folder } : {}) }
}

/** ALMNC-69.2：原建議和 Scott 改過的值；只列有改的那一項。 */
export interface NewNoteChanges {
  /** 目前（改過）的標題，給沒改標題時當作說明的主語。 */
  title: string
  titleChange?: { from: string, to: string }
  folderChange?: { from: string, to: string }
}

/** Scott 改過標題或位置的新增筆記提案：回傳原建議與修改；沒改過（或改回原樣）回傳 null。接受前後都能用。 */
export function newNoteChanges(proposal: Proposal, inboxFolder: string): NewNoteChanges | null {
  const suggested = proposal.suggested
  if (!suggested) return null
  const current = newNoteTarget(proposal, inboxFolder)
  if (!current) return null
  const from = { title: suggested.title, folder: normalizeFolder(suggested.folder ?? inboxFolder) }
  const changes: NewNoteChanges = { title: current.title }
  if (from.title !== current.title) changes.titleChange = { from: from.title, to: current.title }
  if (from.folder !== current.folder) changes.folderChange = { from: from.folder, to: current.folder }
  return changes.titleChange || changes.folderChange ? changes : null
}

/** 活動紀錄用的一行說明（不分語言）：「原標題 → 新標題 · 原位置/ → 新位置/」，最上層寫「/」。 */
export function newNoteChangesNote(changes: NewNoteChanges): string {
  const dir = (folder: string) => folder ? `${folder}/` : '/'
  const head = changes.titleChange ? `${changes.titleChange.from} → ${changes.titleChange.to}` : changes.title
  return changes.folderChange ? `${head} · ${dir(changes.folderChange.from)} → ${dir(changes.folderChange.to)}` : head
}
