// Fork（almanac ALMNC-85.2 骨架）：E 型「文字逐行合併」（設計 1.4）。
// 對基準做三方逐行合併：只有一邊刪的行刪掉、兩邊新增的行都留（本機的在前），
// 同一段兩邊都「刪了又寫」而且寫法不同 → 衝突；衝突段先保留本機版本，另一版交給呼叫端存起來出卡。

export interface TextMergeConflict {
  base: string[]
  local: string[]
  remote: string[]
}

export interface TextMergeResult {
  text: string
  conflicts: TextMergeConflict[]
}

function splitLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

/** LCS 對齊：回傳 base 行號 → other 行號（單調遞增）。文字都很小，O(n·m) 足夠。 */
function lcsMatches(base: string[], other: string[]): Map<number, number> {
  const n = base.length
  const m = other.length
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = base[i] === other[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const matches = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (base[i] === other[j]) {
      matches.set(i, j)
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return matches
}

interface ChunkEdit {
  deleted: Set<number>
  inserted: string[][]
}

/** 把一段 side 表示成「對 base 這段刪了哪幾行、在每個空隙插了哪些行」。 */
function describeEdit(base: string[], side: string[]): ChunkEdit {
  const matches = lcsMatches(base, side)
  const deleted = new Set<number>()
  const inserted: string[][] = Array.from({ length: base.length + 1 }, () => [])
  let sideIndex = 0
  for (let baseIndex = 0; baseIndex <= base.length; baseIndex++) {
    const target = baseIndex < base.length ? matches.get(baseIndex) : side.length
    if (baseIndex < base.length && target === undefined) {
      deleted.add(baseIndex)
      continue
    }
    const end = target as number
    while (sideIndex < end) inserted[baseIndex].push(side[sideIndex++])
    sideIndex = end + 1
  }
  return { deleted, inserted }
}

function sameLines(left: string[], right: string[]) {
  return left.length === right.length && left.every((line, index) => line === right[index])
}

function resolveChunk(base: string[], local: string[], remote: string[]): { lines: string[]; conflict?: TextMergeConflict } {
  if (sameLines(local, base)) return { lines: remote }
  if (sameLines(remote, base)) return { lines: local }
  if (sameLines(local, remote)) return { lines: local }

  const localEdit = describeEdit(base, local)
  const remoteEdit = describeEdit(base, remote)
  const rewrote = (edit: ChunkEdit) => edit.deleted.size > 0 && edit.inserted.some(lines => lines.length > 0)
  if (base.length > 0 && rewrote(localEdit) && rewrote(remoteEdit)) {
    return { lines: local, conflict: { base, local, remote } }
  }

  const lines: string[] = []
  for (let index = 0; index <= base.length; index++) {
    const localInserted = localEdit.inserted[index]
    const remoteInserted = remoteEdit.inserted[index].filter(line => !localInserted.includes(line))
    lines.push(...localInserted, ...remoteInserted)
    if (index < base.length && !localEdit.deleted.has(index) && !remoteEdit.deleted.has(index)) {
      lines.push(base[index])
    }
  }
  return { lines }
}

export function mergeTextLines(baseText: string, localText: string, remoteText: string): TextMergeResult {
  if (localText === remoteText) return { text: localText, conflicts: [] }
  if (localText === baseText) return { text: remoteText, conflicts: [] }
  if (remoteText === baseText) return { text: localText, conflicts: [] }

  const base = splitLines(baseText)
  const local = splitLines(localText)
  const remote = splitLines(remoteText)
  const localMatches = lcsMatches(base, local)
  const remoteMatches = lcsMatches(base, remote)

  const output: string[] = []
  const conflicts: TextMergeConflict[] = []
  let baseStart = 0
  let localStart = 0
  let remoteStart = 0
  for (;;) {
    let stable = baseStart
    while (stable < base.length && !(localMatches.has(stable) && remoteMatches.has(stable))) stable++
    const localEnd = stable < base.length ? localMatches.get(stable) as number : local.length
    const remoteEnd = stable < base.length ? remoteMatches.get(stable) as number : remote.length
    const chunk = resolveChunk(
      base.slice(baseStart, stable),
      local.slice(localStart, localEnd),
      remote.slice(remoteStart, remoteEnd),
    )
    output.push(...chunk.lines)
    if (chunk.conflict) conflicts.push(chunk.conflict)
    if (stable >= base.length) break
    output.push(base[stable])
    baseStart = stable + 1
    localStart = localEnd + 1
    remoteStart = remoteEnd + 1
  }
  return { text: output.join('\n'), conflicts }
}
