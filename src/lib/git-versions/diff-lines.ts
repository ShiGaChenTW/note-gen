/**
 * 版本歷史面板（Issue #54）的逐行 diff：git_version_show() 只回傳兩個版本各自的檔案內容字串，
 * 比較哪些行新增、刪除由前端自己算。用標準 LCS（最長共同子序列）逐行比較，比 greedy 比對更不會把
 * 一段中間插入的文字誤判成整段都換掉。
 */

export type DiffLineType = 'equal' | 'add' | 'remove'

export interface DiffLineEntry {
  type: DiffLineType
  text: string
}

export function diffLines(oldText: string, newText: string): DiffLineEntry[] {
  const oldLines = oldText.length > 0 ? oldText.split('\n') : []
  const newLines = newText.length > 0 ? newText.split('\n') : []
  const n = oldLines.length
  const m = newLines.length

  // lcs[i][j] = 從 oldLines[i:] 和 newLines[j:] 開始的最長共同子序列長度。
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const result: DiffLineEntry[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'equal', text: oldLines[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'remove', text: oldLines[i] })
      i++
    } else {
      result.push({ type: 'add', text: newLines[j] })
      j++
    }
  }
  while (i < n) {
    result.push({ type: 'remove', text: oldLines[i] })
    i++
  }
  while (j < m) {
    result.push({ type: 'add', text: newLines[j] })
    j++
  }
  return result
}
