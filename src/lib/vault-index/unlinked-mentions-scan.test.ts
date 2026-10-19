import { beforeEach, describe, expect, it, vi } from 'vitest'
import { indexNote } from './index-note'
import { clearUnlinkedMentionsCache, isAbortError, mentionNamesFor, scanUnlinkedMentions } from './unlinked-mentions-scan'

const files = new Map<string, string>([
  ['Target.md', '---\naliases: [別名, T]\n---\n# Target\n'],
  ['a.md', '提到 Target 與 別名\n'],
  ['b.md', '[[Target]] 已連結\n'],
  ['c/d.md', 'target 小寫\n'],
  ['img.png', 'Target'],
])
const notes = new Map([...files].map(([path, text]) => [path, indexNote(path, text, 1)]))
const readNote = vi.fn(async (path: string) => files.get(path) ?? null)

beforeEach(() => {
  clearUnlinkedMentionsCache()
  readNote.mockClear()
})

describe('scanUnlinkedMentions', () => {
  it('名稱＝檔名＋別名（T 太短略過）', () => {
    expect(mentionNamesFor('Target.md', notes)).toEqual(['Target', '別名', 'T'])
    expect(mentionNamesFor('Missing.md', notes)).toEqual(['Missing'])
  })

  it('掃索引裡所有 .md（排除目標本身），結果依路徑排序，並快取同一 revision', async () => {
    const groups = await scanUnlinkedMentions('Target.md', { notes, revision: 1, readNote })
    expect(groups.map(group => [group.sourcePath, group.mentions.map(m => m.text)])).toEqual([
      ['a.md', ['Target', '別名']], ['c/d.md', ['target']],
    ])
    expect(readNote.mock.calls.map(([path]) => path).sort()).toEqual(['a.md', 'b.md', 'c/d.md'])
    readNote.mockClear()
    expect(await scanUnlinkedMentions('Target.md', { notes, revision: 1, readNote })).toBe(groups)
    expect(readNote).not.toHaveBeenCalled()
    await scanUnlinkedMentions('Target.md', { notes, revision: 2, readNote })
    expect(readNote).toHaveBeenCalledTimes(3)
  })

  it('最多並行 8 個讀檔', async () => {
    const many = new Map(Array.from({ length: 30 }, (_, i) => [`n${i}.md`, indexNote(`n${i}.md`, 'x', 1)]))
    let active = 0
    let peak = 0
    const slowRead = vi.fn(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return 'Target 提及'
    })
    const groups = await scanUnlinkedMentions('Target.md', { notes: many, revision: 1, readNote: slowRead })
    expect(groups).toHaveLength(30)
    expect(peak).toBe(8)
  })

  it('中止時丟 AbortError 且不快取', async () => {
    const controller = new AbortController()
    const abortingRead = vi.fn(async (path: string) => {
      controller.abort()
      return files.get(path) ?? null
    })
    await expect(scanUnlinkedMentions('Target.md', { notes, revision: 9, readNote: abortingRead, signal: controller.signal }))
      .rejects.toSatisfy(isAbortError)
    await scanUnlinkedMentions('Target.md', { notes, revision: 9, readNote })
    expect(readNote).toHaveBeenCalled()
  })

  it('快取最多留 20 筆', async () => {
    for (let i = 0; i < 25; i++) await scanUnlinkedMentions('Target.md', { notes, revision: 100 + i, readNote })
    readNote.mockClear()
    await scanUnlinkedMentions('Target.md', { notes, revision: 100, readNote })
    expect(readNote).toHaveBeenCalled()
    readNote.mockClear()
    await scanUnlinkedMentions('Target.md', { notes, revision: 124, readNote })
    expect(readNote).not.toHaveBeenCalled()
  })
})
