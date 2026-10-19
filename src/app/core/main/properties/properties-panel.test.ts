import { describe, expect, it } from 'vitest'
import { AlignLeft, List, Binary, CheckSquare, Calendar, Clock, Hash, Users, FileCode } from 'lucide-react'
import { chipValues, initialPropertyValue, propertiesForArticle, propertyIcons, rankPropertyKeys, yamlSourceOf } from './properties-model'
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
  it('六語系提供相同 key，位於 backlinks 與 settings 之間', () => {
    for (const locale of [en, zh, tw, ja, de, pt]) {
      const data = locale as unknown as Record<string, Record<string, unknown>>
      expect(data.properties).toBeDefined()
      expect(Object.keys(data.properties).sort()).toEqual(['title', 'add', 'empty', 'source', 'apply', 'invalidYaml', 'keyPlaceholder', 'valuePlaceholder', 'remove', 'rename', 'unsupported', 'notMarkdown', 'types', 'type', 'keyExists', 'saveFailed'].sort())
      expect(Object.keys(data.properties.types as object).sort()).toEqual(['text', 'multitext', 'number', 'checkbox', 'date', 'datetime', 'tags', 'aliases'].sort())
      const keys = Object.keys(locale)
      expect(keys[keys.indexOf('backlinks') + 1]).toBe('properties')
      expect(keys[keys.indexOf('properties') + 1]).toBe('localGraph')
      expect(keys[keys.indexOf('localGraph') + 1]).toBe('settings')
    }
  })
})
