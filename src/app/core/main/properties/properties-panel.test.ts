import { describe, expect, it } from 'vitest'
import { AlignLeft, List, Binary, CheckSquare, Calendar, Clock, Hash, Users, FileCode } from 'lucide-react'
import { chipValues, formatPropertyDate, initialPropertyValue, propertiesForArticle, propertyIcons, rankPropertyKeys, suggestPropertyValues, yamlSourceOf } from './properties-model'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import tw from '../../../../../messages/zh-TW.json'
import ja from '../../../../../messages/ja.json'
import de from '../../../../../messages/de.json'
import pt from '../../../../../messages/pt-BR.json'

describe('屬性面板資料轉換', () => {
  it('只列 frontmatter，不把行內欄位算進屬性，並套用 vault 型別', () => {
    expect(propertiesForArticle('---\na: 1\ntags: [a]\n---\nx:: value', { a: 'text' }).map(p => [p.key, p.type, p.value])).toEqual([['a', 'text', 1], ['tags', 'tags', ['a']]])
    expect(propertiesForArticle('key:: value', {})).toEqual([])
  })
  it('八種型別及不支援格式各有圖示', () => {
    expect(propertyIcons).toEqual({ text: AlignLeft, multitext: List, number: Binary, checkbox: CheckSquare, date: Calendar, datetime: Clock, tags: Hash, aliases: Users, unsupported: FileCode })
  })
  it('key 聯集依出現次數排序，支援大小寫無關搜尋與空 frontmatter', () => {
    const notes = [{ frontmatter: { z: 1, Alpha: 2 } }, { frontmatter: { z: 2, beta: 1 } }, { frontmatter: null }]
    expect(rankPropertyKeys(notes)).toEqual(['z', 'Alpha', 'beta'])
    expect(rankPropertyKeys(notes, 'AL')).toEqual(['Alpha'])
  })
  it('新增預設值及 chip 轉換', () => {
    expect(['multitext', 'tags', 'aliases'].map(type => initialPropertyValue(type as 'tags'))).toEqual([[], [], []])
    expect(initialPropertyValue('number')).toBe(0)
    expect(initialPropertyValue('checkbox')).toBe(false)
    expect(initialPropertyValue('text')).toBe('')
    expect(chipValues(null)).toEqual([])
    expect(chipValues('tag')).toEqual(['tag'])
    expect(chipValues([1, false, 'x'])).toEqual(['1', 'false', 'x'])
  })
  it.each(['\n', '\r\n'])('原始碼不含 fence 與 BOM，保留 YAML 格式 %j', eol => {
    expect(yamlSourceOf(`\uFEFF---${eol}a: 'x' # 註解${eol}${eol}...${eol}body`)).toBe(`a: 'x' # 註解${eol}`)
    expect(yamlSourceOf('body')).toBe('')
  })
  it('閱讀模式日期依語系輸出，格式不符或不存在的日期原樣顯示', () => {
    expect(formatPropertyDate('2026-10-25', 'zh-TW')).toContain('2026')
    expect(formatPropertyDate('2026-10-19T09:30', 'en')).toMatch(/9:30/)
    expect(formatPropertyDate('2026-02-31', 'en')).toBe('2026-02-31')
    expect(formatPropertyDate('昨天', 'en')).toBe('昨天')
    expect(formatPropertyDate(null, 'en')).toBe('')
  })
  it('選項清單：依次數排序、排除自己與非純量、限制筆數', () => {
    const notes = [
      { path: 'a.md', frontmatter: { status: 'draft', tags: ['x'] } },
      { path: 'b.md', frontmatter: { status: 'done', n: 3 } },
      { path: 'c.md', frontmatter: { status: 'draft' } },
      { path: 'me.md', frontmatter: { status: 'mine' } },
      { path: 'd.md', frontmatter: null },
    ]
    expect(suggestPropertyValues(notes, 'status', 'me.md')).toEqual(['draft', 'done'])
    expect(suggestPropertyValues(notes, 'status', 'me.md', 1)).toEqual(['draft'])
    expect(suggestPropertyValues(notes, 'tags')).toEqual([])
    expect(suggestPropertyValues(notes, 'n')).toEqual(['3'])
  })
  it('六語系提供相同 key，位於 backlinks 與 settings 之間', () => {
    for (const locale of [en, zh, tw, ja, de, pt]) {
      const data = locale as unknown as Record<string, Record<string, unknown>>
      expect(data.properties).toBeDefined()
      expect(Object.keys(data.properties).sort()).toEqual(['title', 'add', 'empty', 'source', 'apply', 'invalidYaml', 'keyPlaceholder', 'valuePlaceholder', 'remove', 'rename', 'unsupported', 'notMarkdown', 'types', 'type', 'keyExists', 'saveFailed',
        // 編輯器內的屬性卡片
        'edit', 'done', 'collapse', 'expand', 'removeAll', 'createTemplate', 'chooseTemplate', 'emptyHint', 'collapsedHint', 'count', 'yes', 'no', 'nestedHint', 'errorHint', 'addPlaceholder', 'suggestions', 'templateCreated'].sort())
      expect(Object.keys(data.properties.types as object).sort()).toEqual(['text', 'multitext', 'number', 'checkbox', 'date', 'datetime', 'tags', 'aliases'].sort())
      const keys = Object.keys(locale)
      expect(keys[keys.indexOf('backlinks') + 1]).toBe('properties')
      expect(keys[keys.indexOf('properties') + 1]).toBe('localGraph')
      expect(keys[keys.indexOf('localGraph') + 1]).toBe('settings')
    }
  })
})
