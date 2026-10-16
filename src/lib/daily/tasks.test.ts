import { describe, expect, it } from 'vitest'
import { bucketFor, isTaskSource, parseTaskLine, setTaskDone, toggleTaskInContent, toggleTaskLine } from './tasks'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10, 30)

describe('parseTaskLine', () => {
  it('非任務行回傳 null', () => {
    expect(parseTaskLine('一般段落')).toBeNull()
    expect(parseTaskLine('- 一般清單')).toBeNull()
    expect(parseTaskLine('-[ ] 少空白')).toBeNull()
    expect(parseTaskLine('- [ ]沒空白')).toBeNull()
  })

  it('解析未完成、完成與其他狀態', () => {
    expect(parseTaskLine('- [ ] 買菜')).toEqual({ done: false, title: '買菜', text: '買菜', due: '', priority: 'mid' })
    expect(parseTaskLine('- [x] 買菜')?.done).toBe(true)
    expect(parseTaskLine('* [X] 買菜')?.done).toBe(true)
    expect(parseTaskLine('+ [/] 進行中')?.done).toBe(false)
    expect(parseTaskLine('- [-] 取消')?.done).toBe(false)
    expect(parseTaskLine('- [ ]')?.title).toBe('')
  })

  it('縮排與 CRLF', () => {
    const t = parseTaskLine('    - [ ] 子任務 📅 2026-10-17\r')
    expect(t?.title).toBe('子任務')
    expect(t?.due).toBe('2026-10-17')
  })

  it('emoji 與 dataview 到期日，dataview 優先', () => {
    expect(parseTaskLine('- [ ] A 📅 2026-10-17')?.due).toBe('2026-10-17')
    expect(parseTaskLine('- [ ] A 📅️2026-10-17')?.due).toBe('2026-10-17')
    expect(parseTaskLine('- [ ] A [due:: 2026-10-18]')?.due).toBe('2026-10-18')
    expect(parseTaskLine('- [ ] A 📅 2026-10-17 due:: 2026-10-20')?.due).toBe('2026-10-20')
    expect(parseTaskLine('- [ ] A overdue:: 2026-10-20')?.due).toBe('')
  })

  it('priority:: 欄位；emoji 優先序（⏫🔼🔽）沿用 entry.js 不辨識', () => {
    expect(parseTaskLine('- [ ] A [priority:: high]')?.priority).toBe('high')
    expect(parseTaskLine('- [ ] A priority:: LOW')?.priority).toBe('low')
    expect(parseTaskLine('- [ ] A priority:: medium')?.priority).toBe('mid')
    expect(parseTaskLine('- [ ] A ⏫')?.priority).toBe('mid')
  })

  it('標題去掉日期、欄位、標籤、🔁 之後內容與 Tasks emoji', () => {
    const t = parseTaskLine('- [ ] 繳房租 #家 #finance/月 ⏫ 📅 2026-10-31 🔁 every month ✅ 2026-10-01')
    expect(t?.title).toBe('繳房租')
    expect(parseTaskLine('- [ ] 寫 #1 號報告')?.title).toBe('寫 #1 號報告')
    expect(parseTaskLine('- [ ] 會議（project:: X） 準備')?.title).toBe('會議 準備')
    expect(parseTaskLine('- [ ] 讀書 ⏳ 2026-10-17 🛫 2026-10-16 ➕ 2026-10-01')?.title).toBe('讀書 2026-10-17 2026-10-16 2026-10-01')
  })
})

describe('bucketFor', () => {
  const now = at(2026, 10, 17)
  it('沒有到期日 → other', () => {
    expect(bucketFor({ done: false, due: '' }, now)).toBe('other')
  })
  it('逾期只算未完成', () => {
    expect(bucketFor({ done: false, due: '2026-10-16' }, now)).toBe('overdue')
    expect(bucketFor({ done: true, due: '2026-10-16' }, now)).toBe('other')
  })
  it('今天含已完成', () => {
    expect(bucketFor({ done: false, due: '2026-10-17' }, now)).toBe('today')
    expect(bucketFor({ done: true, due: '2026-10-17' }, now)).toBe('today')
  })
  it('未來 → other', () => {
    expect(bucketFor({ done: false, due: '2026-10-18' }, now)).toBe('other')
  })
  it('跨年與午夜邊界用本地日期', () => {
    expect(bucketFor({ done: false, due: '2025-12-31' }, new Date(2026, 0, 1, 0, 0))).toBe('overdue')
    expect(bucketFor({ done: false, due: '2025-12-31' }, new Date(2025, 11, 31, 23, 59))).toBe('today')
  })
})

describe('isTaskSource', () => {
  it('排除指定前綴', () => {
    expect(isTaskSource('10 Inbox/a.md')).toBe(false)
    expect(isTaskSource('00 System/05 templates/daily.md')).toBe(false)
    expect(isTaskSource('temp/x.md')).toBe(false)
    expect(isTaskSource('20 Journal/21 Daily/20261017.md')).toBe(true)
    expect(isTaskSource('notes/temp/x.md')).toBe(true)
  })
})

describe('setTaskDone / toggleTaskLine', () => {
  it('只改方括號內字元', () => {
    expect(toggleTaskLine('  - [ ] 買菜 📅 2026-10-17 #家')).toBe('  - [x] 買菜 📅 2026-10-17 #家')
    expect(toggleTaskLine('- [X] 買菜')).toBe('- [ ] 買菜')
    expect(toggleTaskLine('- [/] 進行中')).toBe('- [x] 進行中')
    expect(toggleTaskLine('一般段落')).toBeNull()
  })

  it('狀態相同時回傳原行', () => {
    expect(setTaskDone('- [x] A', true)).toBe('- [x] A')
  })

  it('保留行尾 \\r', () => {
    expect(toggleTaskLine('- [ ] A\r')).toBe('- [x] A\r')
  })

  it('有 today 時補上與移除 ✅ 日期，放在 block id 之前', () => {
    const today = at(2026, 10, 17)
    expect(setTaskDone('- [ ] A', true, { today })).toBe('- [x] A ✅ 2026-10-17')
    expect(setTaskDone('- [ ]', true, { today })).toBe('- [x] ✅ 2026-10-17')
    expect(setTaskDone('- [ ] A ^abc-1', true, { today })).toBe('- [x] A ✅ 2026-10-17 ^abc-1')
    expect(setTaskDone('- [ ] A  \r', true, { today })).toBe('- [x] A ✅ 2026-10-17  \r')
    expect(setTaskDone('- [x] A ✅ 2026-10-01 ^abc', false, { today })).toBe('- [ ] A ^abc')
  })

  it('往返：切換兩次與原行逐字相同', () => {
    const today = at(2026, 2, 29)
    const lines = [
      '- [ ] 買菜',
      '\t* [ ] tab 縮排 📅 2026-10-17 ⏰ 09:00 ⏫ #家',
      '- [ ] 有尾端空白   ',
      '- [ ] CRLF\r',
      '- [ ] block ^id-9',
      '- [ ]',
      '- [x] 已完成 ✅ 2026-10-01',
      '+ [X] 大寫完成',
    ]
    for (const line of lines) {
      expect(toggleTaskLine(toggleTaskLine(line)!)).toBe(line.replace('[X]', '[x]'))
      const done = parseTaskLine(line)!.done
      if (!done) expect(toggleTaskLine(toggleTaskLine(line, { today })!, { today })).toBe(line)
    }
  })
})

describe('toggleTaskInContent', () => {
  const md = '---\r\ntitle: x\r\n---\r\n# 今天\r\n- [ ] A\r\n- 不是任務\r\n  - [x] B ✅ 2026-10-16\r\n'

  it('只改指定行，其他行逐字不變（CRLF、frontmatter、結尾換行）', () => {
    const out = toggleTaskInContent(md, 4)!
    expect(out).toBe(md.replace('- [ ] A', '- [x] A'))
    const before = md.split('\n')
    const after = out.split('\n')
    expect(after).toHaveLength(before.length)
    before.forEach((l, i) => { if (i !== 4) expect(after[i]).toBe(l) })
  })

  it('往返：切換兩次等於原文', () => {
    const today = at(2026, 10, 17)
    expect(toggleTaskInContent(toggleTaskInContent(md, 4, { today })!, 4, { today })).toBe(md)
    expect(toggleTaskInContent(toggleTaskInContent(md, 6)!, 6)).toBe(md)
  })

  it('非任務行或越界回傳 null', () => {
    expect(toggleTaskInContent(md, 5)).toBeNull()
    expect(toggleTaskInContent(md, 99)).toBeNull()
    expect(toggleTaskInContent(md, -1)).toBeNull()
  })

  it('沒有結尾換行的檔案維持沒有', () => {
    expect(toggleTaskInContent('a\n- [ ] B', 1)).toBe('a\n- [x] B')
  })
})
