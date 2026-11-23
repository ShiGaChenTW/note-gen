// Fork（almanac ALMNC-65.1）：提案卡的差異檢視（改了什麼）。純函式。
// 逐行比較沿用版本歷史的 LCS（lib/git-versions/diff-lines.ts），先去掉頭尾相同的行再比，
// 中段太大時不跑 LCS（O(n×m)），直接當整段換掉，避免大筆記卡住畫面。沒變的行只留變動處上下幾行，其餘摺成「N 行沒變」。
import { diffLines, type DiffLineType } from '@/lib/git-versions/diff-lines'

export type ChangeRow =
  | { type: DiffLineType, text: string }
  | { type: 'gap', count: number }

/** 中段行數相乘超過這個值就不跑 LCS。 */
export const LCS_MAX_CELLS = 1_000_000

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** before → after 的逐行差異（equal／remove／add），before 為 null 時全是新增、after 為 null 時全是刪除。 */
export function changeLines(before: string | null, after: string | null): Array<{ type: DiffLineType, text: string }> {
  const a = splitLines(before ?? '')
  const b = splitLines(after ?? '')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle = midA.length * midB.length > LCS_MAX_CELLS
    ? [...midA.map(text => ({ type: 'remove' as const, text })), ...midB.map(text => ({ type: 'add' as const, text }))]
    // 每行前面墊一個字元：diffLines 把空字串當成「沒有行」，只剩一個空行時會漏掉。
    : diffLines(midA.map(text => `\u0000${text}`).join('\n'), midB.map(text => `\u0000${text}`).join('\n'))
        .map(line => ({ type: line.type, text: line.text.slice(1) }))
  return [
    ...a.slice(0, start).map(text => ({ type: 'equal' as const, text })),
    ...(midA.length === 0 && midB.length === 0 ? [] : middle),
    ...a.slice(endA).map(text => ({ type: 'equal' as const, text })),
  ]
}

/** 只留變動處上下 context 行，其餘沒變的行摺成一個 gap。完全沒變回傳空陣列。 */
export function changeRows(before: string | null, after: string | null, context = 2): ChangeRow[] {
  const lines = changeLines(before, after)
  const changed = lines.map(line => line.type !== 'equal')
  if (!changed.includes(true)) return []
  const keep = lines.map((_, index) => {
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) if (changed[k]) return true
    return false
  })
  const rows: ChangeRow[] = []
  let gap = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (gap) rows.push({ type: 'gap', count: gap })
      gap = 0
      rows.push(line)
    } else gap++
  })
  if (gap) rows.push({ type: 'gap', count: gap })
  return rows
}

/** 新增、刪除各幾行（卡片上的「+3 −1」）。 */
export function changeStats(before: string | null, after: string | null): { added: number, removed: number } {
  let added = 0
  let removed = 0
  for (const line of changeLines(before, after)) {
    if (line.type === 'add') added++
    else if (line.type === 'remove') removed++
  }
  return { added, removed }
}
