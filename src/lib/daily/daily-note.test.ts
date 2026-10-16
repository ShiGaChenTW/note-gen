import { describe, expect, it } from 'vitest'
import { cleanText, parseDailyNote, stamp } from './daily-note'

const SAMPLE = [
  '---',
  'date: 2026-10-17',
  '---',
  '# 20261017',
  '> 一句話定調 → **穩住節奏** [[專案A|A 案]]',
  '',
  '## 早晨',
  '### 唯一要務',
  '',
  '- [ ] 交出 `D2` 規格 📅 2026-10-17',
  '',
  '### 三件 MIT',
  '- [ ] 🔴 寫測試',
  '- [x] 🟡 回信',
  '- 🟢 散步',
  '- ',
  '',
  '### 錨點時段',
  '- 9:00-10:30 深度工作',
  '- 14:00 [[會議]]',
  '- 午睡',
  '',
  '## 捕捉軌',
  '> 說明文字',
  '- 想法一 #閃',
  '- [ ] 要做的事',
  '- 文章 #讀',
  '- ',
  '',
  '## 沉澱',
  '- **今天真正完成**：寫完解析器',
  '- **卡住的地方**：',
  '---',
  '- **不算**：這裡在分隔線之後',
  'morning:: done',
].join('\n')

describe('cleanText', () => {
  it('去掉 emoji、inline 欄位、wikilink、粗體、行內碼', () => {
    expect(cleanText('🔴 **重點** [[頁|別名]] [[頁]] `code` (k:: v)  尾')).toBe('重點 別名 頁 code 尾')
  })
})

describe('parseDailyNote', () => {
  const p = parseDailyNote(SAMPLE)

  it('一句話定調', () => {
    expect(p.tone).toBe('穩住節奏 A 案')
  })

  it('唯一要務跳過標題後的空行', () => {
    expect(p.oneThing?.text).toBe('交出 D2 規格 2026-10-17')
    expect(p.oneThing?.isTask).toBe(true)
    expect(p.oneThing?.lineNo).toBe(9)
  })

  it('三件 MIT 帶紅黃綠優先序，空項略過', () => {
    expect(p.mits.map(m => [m.text, m.priority, m.done])).toEqual([
      ['寫測試', 3, false],
      ['回信', 2, true],
      ['散步', 1, false],
    ])
  })

  it('錨點時段解析時間並補零', () => {
    expect(p.anchors.map(a => [a.time, a.text])).toEqual([
      ['09:00', '深度工作'],
      ['14:00', '會議'],
      ['', '午睡'],
    ])
  })

  it('捕捉軌計數略過引用行與空項', () => {
    expect(p.capture).toEqual({ total: 3, flash: 1, read: 1, task: 1 })
  })

  it('沉澱只看到分隔線為止', () => {
    expect(p.reflection).toEqual({ filled: true, done: '寫完解析器' })
  })

  it('早晨與復盤標記', () => {
    expect(p.morning).toBe(true)
    expect(p.reviewed).toBe(false)
  })

  it('空筆記', () => {
    expect(parseDailyNote('')).toEqual({
      tone: null,
      oneThing: null,
      mits: [],
      anchors: [],
      capture: { total: 0, flash: 0, read: 0, task: 0 },
      reflection: { filled: false, done: null },
      morning: false,
      reviewed: false,
    })
  })

  it('CRLF 與 LF 結果相同', () => {
    expect(parseDailyNote(SAMPLE.replace(/\n/g, '\r\n'))).toEqual(
      // raw 欄位已去掉 \r，所以整個物件相同
      parseDailyNote(SAMPLE),
    )
  })
})

describe('stamp', () => {
  it('在結尾寫入標記，收掉多餘空白', () => {
    expect(stamp('# 今天\n\n\n', 'morning')).toEqual({ changed: true, key: 'morning', content: '# 今天\nmorning:: done\n' })
    expect(stamp('# 今天', 'review').content).toBe('# 今天\nreviewed:: done\n')
  })

  it('沿用 CRLF', () => {
    expect(stamp('a\r\nb\r\n', 'review').content).toBe('a\r\nb\r\nreviewed:: done\r\n')
  })

  it('已有標記時不變', () => {
    const md = 'a\nreviewed:: done  \nb\n'
    expect(stamp(md, 'review')).toEqual({ changed: false, key: 'reviewed', content: md })
  })

  it('morning 與 reviewed 互不影響', () => {
    const once = stamp('a\n', 'morning').content
    const twice = stamp(once, 'review').content
    expect(twice).toBe('a\nmorning:: done\nreviewed:: done\n')
    expect(parseDailyNote(twice)).toMatchObject({ morning: true, reviewed: true })
  })
})
