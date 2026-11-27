// Fork（almanac ALMNC-85.4，設計 2.11 第一層）：內建同步寫進筆記庫的 MOC 記成 App 寫入。
import { beforeEach, describe, expect, it } from 'vitest'
import { noteAppWrite, noteSyncWrite, takeAppWrites } from './app-writes'

const MOC = '---\nid: M-1\nkind: domain\n---\n# 時間管理\n'

beforeEach(() => {
  takeAppWrites()
})

describe('noteSyncWrite', () => {
  const cases: Array<{ name: string; path: string; content: string | Uint8Array; recorded: boolean }> = [
    { name: 'MOC 文字 → 記下（before 未知＝直接換成新內容）', path: '20 領域/時間管理.md', content: MOC, recorded: true },
    { name: 'MOC 位元組（遠端下載）→ 解碼後記下', path: '20 領域/時間管理.md', content: new TextEncoder().encode(MOC), recorded: true },
    { name: '一般筆記 → 不記', path: '10 知識/a.md', content: '# a\n', recorded: false },
    { name: '不是 Markdown（附件）→ 不記', path: '20 領域/圖.png', content: new Uint8Array([0x89, 0x50]), recorded: false },
    { name: '不是合法 UTF-8 → 不記', path: '20 領域/壞掉.md', content: new Uint8Array([0xff, 0xfe, 0xfd]), recorded: false },
  ]
  it.each(cases)('$name', ({ path, content, recorded }) => {
    noteSyncWrite(path, content)
    expect(takeAppWrites()).toEqual(recorded ? [{ path, before: undefined, after: MOC }] : [])
  })

  it('跟 App 自己的寫入排在同一串事件裡（依發生順序）', () => {
    noteAppWrite('20 領域/時間管理.md', null, MOC)
    noteSyncWrite('20 領域/時間管理.md', `${MOC}\n- 同步來的\n`)
    expect(takeAppWrites().map(event => event.before)).toEqual([null, undefined])
  })
})
