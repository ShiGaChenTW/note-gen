/**
 * 大 vault 效能基準用的合成筆記。固定 seed 可重現。
 * 10 個兩層資料夾、每篇 1～3 KB（JS 字串長度，填充為 ASCII）、
 * frontmatter 3～6 個屬性、3 個標籤（含巢狀）、5 個 wikilink
 * （同名、別名、標題、另一篇、完整路徑）、2 個任務、2 個標題、1 個區塊 id。
 */

export interface SyntheticNote {
  path: string
  content: string
}

/** 10 個兩層資料夾。前 10 篇各放一篇同名 `Note.md`，用來走同名解析。 */
export const SYNTHETIC_FOLDERS = [
  '00 Alpha/00 Notes',
  '00 Alpha/01 Notes',
  '01 Beta/00 Notes',
  '01 Beta/01 Notes',
  '02 Gamma/00 Notes',
  '02 Gamma/01 Notes',
  '03 Delta/00 Notes',
  '03 Delta/01 Notes',
  '04 Epsilon/00 Notes',
  '04 Epsilon/01 Notes',
] as const

const MIN_CHARS = 1024
const MAX_CHARS = 3072
const FILLER = 'Synthetic note padding for vault performance measurement. '

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function noteBase(index: number): string {
  return index < SYNTHETIC_FOLDERS.length ? 'Note' : `N${index}`
}

function padTo(body: string, target: number): string {
  if (body.length >= target) return body
  let out = body
  while (out.length < target) {
    const need = target - out.length
    out += need >= FILLER.length ? FILLER : FILLER.slice(0, need)
  }
  return out
}

function noteContent(index: number, count: number, seed: number, rng: () => number): string {
  const base = noteBase(index)
  const folder = SYNTHETIC_FOLDERS[index % SYNTHETIC_FOLDERS.length]
  const other = count === 0 ? 0 : (index + 1) % count
  const otherBase = noteBase(other)
  const otherFolder = SYNTHETIC_FOLDERS[other % SYNTHETIC_FOLDERS.length]
  const day = String(1 + (index % 28)).padStart(2, '0')
  const lines = [
    `title: "${base}"`,
    `status: ${index % 2 === 0 ? 'active' : 'draft'}`,
    `tags: [project/p${index % 4}, topic/t${index % 20}, status/s${index % 3}]`,
  ]
  if ((index + seed) % 3 !== 0) lines.push(`aliases: [別名${index}]`)
  if ((index + seed) % 4 !== 0) lines.push(`priority: ${1 + (index % 5)}`)
  if ((index + seed) % 5 !== 0) lines.push(`due: 2026-10-${day}`)
  const body = `---
${lines.join('\n')}
---

# ${base}

## 第二節

- [ ] 未完成的任務 📅 2026-10-19
- [x] 已完成的任務 📅 2026-10-18

這裡提到 Note 與別名甲。
- [[Note]]
- [[Note|顯示${index}]]
- [[Note#第二節]]
- [[${otherBase}]]
- [[${otherFolder}/${otherBase}]]

區塊。 ^blk-${index}
`
  const target = MIN_CHARS + Math.floor(rng() * (MAX_CHARS - MIN_CHARS + 1))
  return padTo(body, Math.max(target, Math.min(body.length, MAX_CHARS)))
}

/** 產生 n 篇筆記。相同 `(n, seed)` 位元組等級一致。 */
export function makeSyntheticVault(count: number, seed: number): SyntheticNote[] {
  if (!Number.isInteger(count) || count < 0) throw new Error(`makeSyntheticVault 需要非負整數，收到 ${count}`)
  const rng = mulberry32(seed)
  const notes: SyntheticNote[] = []
  for (let index = 0; index < count; index++) {
    const folder = SYNTHETIC_FOLDERS[index % SYNTHETIC_FOLDERS.length]
    notes.push({
      path: `${folder}/${noteBase(index)}.md`,
      content: noteContent(index, count, seed, rng),
    })
  }
  return notes
}
