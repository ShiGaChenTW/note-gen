import { describe, expect, it } from 'vitest'
import {
  collectRandomSources,
  dailyTemplateCandidates,
  pickRandomLine,
  renderTemplate,
  selectDailyTemplate,
} from './template'

// 2026-10-17（星期六）08:05
const now = new Date(2026, 9, 17, 8, 5)
const mon = new Date(2026, 9, 19)
const tue = new Date(2026, 9, 20)

describe('renderTemplate', () => {
  it('展開 date、time、weekday、title', () => {
    const template = '# {{title}}\n{{date}} {{weekday}} {{time}}'
    expect(renderTemplate(template, { now, title: '20261017' })).toBe('# 20261017\n2026-10-17 Saturday 08:05')
  })

  it('date 支援自訂格式', () => {
    expect(renderTemplate('{{date:YYYY/MM/DD ddd}}', { now })).toBe('2026/10/17 Sat')
    expect(renderTemplate('[[{{date:YYYYMMDD}}]]', { now })).toBe('[[20261017]]')
  })

  it('容忍大括號內的空白', () => {
    expect(renderTemplate('{{ date : YYYYMMDD }} {{ weekday }}', { now })).toBe('20261017 Saturday')
  })

  it('沒給 title 時展開為空字串', () => {
    expect(renderTemplate('[{{title}}]', { now })).toBe('[]')
  })

  it('random 由注入的來源取行', () => {
    const sources: string[] = []
    const randomLine = (path: string) => {
      sources.push(path)
      return `quote from ${path}`
    }
    expect(renderTemplate('> {{random:30 Notes/Quotes.md}}', { now, randomLine })).toBe('> quote from 30 Notes/Quotes.md')
    expect(sources).toEqual(['30 Notes/Quotes.md'])
  })

  it('random 沒有來源或來源回傳 null 時展開為空字串', () => {
    expect(renderTemplate('> {{random:Quotes.md}}', { now })).toBe('> ')
    expect(renderTemplate('> {{random:Quotes.md}}', { now, randomLine: () => null })).toBe('> ')
  })

  it('不認得的 token 與缺參數的 random 原樣保留', () => {
    expect(renderTemplate('{{unknown}} {{random}} {{tp.date.now()}}', { now })).toBe('{{unknown}} {{random}} {{tp.date.now()}}')
  })

  it('沒有 token 的內容逐字不變', () => {
    const content = '---\ntags: [daily]\n---\n\n## Tasks\n- [ ] 📅 2026-10-17\n'
    expect(renderTemplate(content, { now })).toBe(content)
  })
})

describe('collectRandomSources', () => {
  it('列出所有 random 路徑並去重', () => {
    const template = '{{random:A.md}}\n{{random: B/C.md }}\n{{random:A.md}}\n{{date}}'
    expect(collectRandomSources(template)).toEqual(['A.md', 'B/C.md'])
  })

  it('沒有 random 時回傳空陣列', () => {
    expect(collectRandomSources('{{date}}')).toEqual([])
  })
})

describe('pickRandomLine', () => {
  const content = '---\ntitle: Quotes\n---\n\nfirst\n\n  second  \nthird\n'

  it('略過 frontmatter 與空白行，依注入的亂數挑行', () => {
    expect(pickRandomLine(content, () => 0)).toBe('first')
    expect(pickRandomLine(content, () => 0.5)).toBe('second')
    expect(pickRandomLine(content, () => 0.999)).toBe('third')
  })

  it('亂數為 1 時不越界', () => {
    expect(pickRandomLine(content, () => 1)).toBe('third')
  })

  it('支援 CRLF', () => {
    expect(pickRandomLine('---\r\na: 1\r\n---\r\nonly\r\n', () => 0)).toBe('only')
  })

  it('沒有內容時回傳 null', () => {
    expect(pickRandomLine('', () => 0)).toBeNull()
    expect(pickRandomLine('---\na: 1\n---\n\n   \n', () => 0)).toBeNull()
  })
})

describe('selectDailyTemplate', () => {
  const settings = {
    defaultTemplate: 'Templates/Daily.md',
    weekdayTemplates: { monday: 'Templates/Monday.md', tuesday: 'Templates/Tuesday.md' },
  }

  it('星期一、星期二各自套用專屬模板', () => {
    expect(selectDailyTemplate(mon, settings)).toBe('Templates/Monday.md')
    expect(selectDailyTemplate(tue, settings)).toBe('Templates/Tuesday.md')
  })

  it('沒有星期專屬模板時用預設模板', () => {
    expect(selectDailyTemplate(now, settings)).toBe('Templates/Daily.md')
  })

  it('空字串視為未設定', () => {
    expect(selectDailyTemplate(mon, { defaultTemplate: 'D.md', weekdayTemplates: { monday: '  ' } })).toBe('D.md')
  })

  it('都沒有設定時回傳 null（建立空白筆記）', () => {
    expect(selectDailyTemplate(now, {})).toBeNull()
    expect(selectDailyTemplate(mon, { defaultTemplate: '' })).toBeNull()
  })

  it('candidates 依優先序列出並去重', () => {
    expect(dailyTemplateCandidates(mon, settings)).toEqual(['Templates/Monday.md', 'Templates/Daily.md'])
    expect(dailyTemplateCandidates(mon, { defaultTemplate: 'A.md', weekdayTemplates: { monday: 'A.md' } })).toEqual(['A.md'])
    expect(dailyTemplateCandidates(now, settings)).toEqual(['Templates/Daily.md'])
  })
})
