/**
 * 版本歷史面板（Issue #54）的純邏輯：預設只顯示提示詞版本、哪兩筆被選去比較 diff、
 * 回復時要寫進 commit 的摘要。UI（version-history-sheet.tsx）只處理畫面與呼叫 Rust command。
 */
import type { GitVersionLogEntry } from './types'

const MAX_DIFF_SELECTION = 2

/** 預設只顯示「提示詞版本」；切換後顯示全部（含自動快照與解析不出 kind 的既有 commit）。 */
export function filterVersionLogEntries(
  entries: GitVersionLogEntry[],
  options: { showAutoSnapshots: boolean },
): GitVersionLogEntry[] {
  if (options.showAutoSnapshots) return entries
  return entries.filter(entry => entry.kind === 'prompt-version')
}

/**
 * 最多同時選兩筆去比較：已選的再點一次會取消；選了兩筆後再點第三筆，
 * 會丟掉最早選的那筆、留下最新點的兩筆（先選先丟）。
 */
/** 打開面板時的預設篩選：沒有任何提示詞版本的筆記（一般筆記、剛建立的提示詞）直接顯示自動快照，否則面板會是空的。 */
export function defaultShowAutoSnapshots(entries: Pick<GitVersionLogEntry, 'kind'>[]): boolean {
  return !entries.some(entry => entry.kind === 'prompt-version')
}

export function toggleVersionSelection(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter(existing => existing !== id)
  if (selected.length < MAX_DIFF_SELECTION) return [...selected, id]
  return [...selected.slice(1), id]
}

/**
 * 選滿兩筆時，依 entries（由新到舊）裡的順序回傳 [較舊, 較新]，讓 diff 永遠是「舊→新」方向，
 * 不受使用者點選的先後順序影響。未選滿兩筆、或選到不在列表裡的 id（例如列表剛好被重新整理掉）回傳 null。
 */
export function resolveDiffPair(
  selected: string[],
  entries: GitVersionLogEntry[],
): [GitVersionLogEntry, GitVersionLogEntry] | null {
  if (selected.length !== MAX_DIFF_SELECTION) return null
  const [a, b] = selected.map(id => entries.find(entry => entry.id === id))
  if (!a || !b) return null
  const indexA = entries.indexOf(a)
  const indexB = entries.indexOf(b)
  return indexA > indexB ? [a, b] : [b, a]
}

/** 自動快照摘要（AUTO_SNAPSHOT_COMMIT_SUMMARY）不隨介面語言變動，回復摘要跟它一致，方便切換語言後仍能在 git log 裡用同一組字找到所有回復紀錄。 */
export const RESTORE_COMMIT_SUMMARY_PREFIX = '回復到'

/** 組回復時要寫進 commit 的摘要：「回復到 <短 id> <原摘要>」；沒有摘要（例如既有 commit）就只用短 id。 */
export function buildRestoreCommitSummary(entry: Pick<GitVersionLogEntry, 'shortId' | 'summary'>): string {
  const label = entry.summary ? `${entry.shortId} ${entry.summary}` : entry.shortId
  return `${RESTORE_COMMIT_SUMMARY_PREFIX} ${label}`
}

/** 面板上顯示給使用者看的版本標籤（確認回復對話框、Toast 用），跟 commit 摘要分開、會隨介面語言呈現日期等格式。 */
export function buildVersionDisplayLabel(entry: Pick<GitVersionLogEntry, 'shortId' | 'summary'>): string {
  return entry.summary ? `${entry.summary} (${entry.shortId})` : entry.shortId
}
