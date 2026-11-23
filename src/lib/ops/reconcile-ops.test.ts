// Fork（almanac ALMNC-69.10）：Obsidian 手動編輯 MOC 記成的兩種新操作（改關係說明、章節改名）套用與復原互為反向。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formalEntries, parseMoc } from '@/lib/moc/parse'
import { inverseOf } from './inverse'
import { createOpsService } from './service'
import { createMemoryOpsIo, createMemoryOpsStore } from './testing'
import type { OpSpec } from './types'

const MOC_PATH = '20 領域/時間管理.md'
const M = 'M-20261112-060012-VPB3'
const C_WHAT = 'C-20261112-060020-N9NR'
const N_SAY_NO = 'N-20261110-063015-B3XR'
const fixture = readFileSync(join(__dirname, '..', 'moc', 'fixtures', '時間管理.md'), 'utf8')
const note = (id: string) => `---\nid: ${id}\ntype: knowledge\n---\n內文\n`
const ref = { noteTitle: '說不比提高效率更省時間', notePath: '10 知識/說不比提高效率更省時間.md', noteId: N_SAY_NO, mocId: M, mocName: '時間管理', mocPath: MOC_PATH }
const scott = { actor: 'scott' as const, actorId: 'scott' }

function setup() {
  const files: Record<string, string> = { [MOC_PATH]: fixture, [ref.notePath]: note(N_SAY_NO) }
  const io = createMemoryOpsIo(files, { [M]: MOC_PATH, [N_SAY_NO]: ref.notePath })
  const service = createOpsService({ fs: io.fs, writer: io.writer, store: createMemoryOpsStore([]), now: () => 1_000_000 })
  return { files, service }
}

const relationOf = (raw: string) => formalEntries(parseMoc(raw, MOC_PATH)).find(({ entry }) => entry.target.endsWith('說不比提高效率更省時間'))?.entry.relation

describe('moc.entry.relation / moc.chapter.rename', () => {
  it('反向的反向等於原操作', () => {
    const specs: OpSpec[] = [
      { kind: 'moc.entry.relation', ...ref, chapterId: C_WHAT, before: '舊', after: '新' },
      { kind: 'moc.chapter.rename', mocId: M, mocName: '時間管理', mocPath: MOC_PATH, chapterId: C_WHAT, before: '舊章', after: '新章' },
    ]
    for (const spec of specs) expect(inverseOf(inverseOf(spec))).toEqual(spec)
  })

  it('改關係說明 ↔ 改回原說明', async () => {
    const { files, service } = setup()
    const before = relationOf(files[MOC_PATH])!
    const [op] = await service.applyOps([{ kind: 'moc.entry.relation', ...ref, chapterId: C_WHAT, before, after: 'Scott 改的說明' }], scott)
    expect(relationOf(files[MOC_PATH])).toBe('Scott 改的說明')
    expect((await service.undoOp(op.id)).status).toBe('undone')
    expect(files[MOC_PATH]).toBe(fixture)
  })

  it('章節改名（依 C 編號）↔ 改回原名', async () => {
    const { files, service } = setup()
    const chapter = parseMoc(fixture, MOC_PATH).chapters.find(item => item.id === C_WHAT)!
    const [op] = await service.applyOps([{ kind: 'moc.chapter.rename', mocId: M, mocName: '時間管理', mocPath: MOC_PATH, chapterId: C_WHAT, before: chapter.title, after: '先決定不做什麼' }], scott)
    expect(parseMoc(files[MOC_PATH], MOC_PATH).chapters.find(item => item.id === C_WHAT)?.title).toBe('先決定不做什麼')
    expect((await service.undoOp(op.id)).status).toBe('undone')
    expect(files[MOC_PATH]).toBe(fixture)
  })
})
