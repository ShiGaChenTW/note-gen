import { describe, expect, it } from 'vitest'
import { applyFrontmatterEdit as edit, applyFrontmatterEditToBlock, inferPropertyType, listProperties, validatePropertySource, yamlScalarText, type PropertyType } from './frontmatter-edit'

const cases: Array<[PropertyType, unknown]> = [
  ['text', '文字'], ['multitext', ['a', 'b']], ['number', 42], ['checkbox', true],
  ['date', '2026-10-19'], ['datetime', '2026-10-19T12:34:56'], ['tags', ['a/b', '中文']], ['aliases', ['別名', '其他']],
]
const untouched = '# 前註解\nkeep: "原樣" # 註解\n\nnested:\n  child: [a, b]\n'
const body = '內文\nkey:: 行內欄位\n'

describe('逐 key 編輯', () => {
  for (const eol of ['\n', '\r\n']) {
    const preserve = untouched.replaceAll('\n', eol)
    const tail = `---${eol}${body.replaceAll('\n', eol)}`
    for (const [type, value] of cases) {
      it(`${JSON.stringify(eol)} ${type} 新增、設定、改名與刪除只改目標`, () => {
        const original = `---${eol}target: old # 同行${eol}${preserve}${tail}`
        const set = edit(original, { kind: 'set', key: 'target', value, type })
        expect(set.endsWith(preserve + tail)).toBe(true)
        expect(set).toContain('# 同行')
        expect(listProperties(set.slice(0, set.indexOf(tail) + 3 + eol.length))[0].value).toEqual(value)
        const renamed = edit(set, { kind: 'rename', key: 'target', newKey: '新名稱' })
        expect(renamed).toBe(set.replace('target:', '新名稱:'))
        const removed = edit(renamed, { kind: 'remove', key: '新名稱' })
        expect(removed).toBe(`---${eol}${preserve}${tail}`)
        const added = edit(removed, { kind: 'set', key: 'added', value, type })
        expect(added.startsWith(`---${eol}${preserve}`)).toBe(true)
        expect(added.endsWith(tail)).toBe(true)
        expect(listProperties(added.slice(0, added.indexOf(tail) + 3 + eol.length)).at(-1)?.value).toEqual(value)
      })
    }
    it('flow 清單維持 flow 寫法，其他行保留', () => {
      const original = `---${eol}target: [a, b] # 同行${eol}${preserve}${tail}`
      const next = edit(original, { kind: 'set', key: 'target', value: ['[[連結]]', 'a: b'], type: 'multitext' })
      expect(next).toBe(`---${eol}target: ["[[連結]]", "a: b"] # 同行${eol}${preserve}${tail}`)
    })
  }
  it.each(['[[連結]]', 'a # b', 'a: b', 'true', '123', '[a]', '"quoted', "'quoted", ''])('字串往返 %s', value => {
    const next = edit('---\na: old\nkeep: \'x\'\n---\nbody', { kind: 'set', key: 'a', value, type: 'text' })
    expect(next.endsWith("keep: 'x'\n---\nbody")).toBe(true)
    expect(listProperties(next.split('body')[0])[0].value).toBe(value)
  })
  it('block 清單、空清單、清單註解與鄰接註解', () => {
    const content = '---\na: # 清單\n  - x\n  - y\n# keep\nb: z\n---\nbody'
    expect(edit(content, { kind: 'set', key: 'a', value: [], type: 'multitext' })).toBe('---\na: [] # 清單\n# keep\nb: z\n---\nbody')
    expect(edit(content, { kind: 'remove', key: 'a' })).toBe('---\n# keep\nb: z\n---\nbody')
  })
  it('改純量只換值本身，值後面的空白與註解一字不差（Issue #11）', () => {
    expect(edit('---\ntitle: "x: y"  # 行尾註解\n---\nbody', { kind: 'set', key: 'title', value: '新值', type: 'text' })).toBe('---\ntitle: 新值  # 行尾註解\n---\nbody')
    expect(edit('---\na: 1\t# tab\nb: 2\n---\n', { kind: 'set', key: 'a', value: 2, type: 'number' })).toBe('---\na: 2\t# tab\nb: 2\n---\n')
    expect(edit('---\ndone: false   \n---\n', { kind: 'set', key: 'done', value: true, type: 'checkbox' })).toBe('---\ndone: true   \n---\n')
    expect(edit('---\r\ndue: 2026-10-25  # d\r\n---\r\n', { kind: 'set', key: 'due', value: '2026-11-01', type: 'date' })).toBe('---\r\ndue: 2026-11-01  # d\r\n---\r\n')
  })

  it('空值行的註解與換行', () => {
    const content = '---\na: # hi\nb: z\n---\nbody'
    expect(edit(content, { kind: 'set', key: 'a', value: 'v', type: 'text' })).toBe('---\na: v # hi\nb: z\n---\nbody')
    expect(edit(content, { kind: 'remove', key: 'a' })).toBe('---\nb: z\n---\nbody')
  })
  it.each(['\n', '\r\n'])('無 frontmatter、BOM 與刪到空 %j', eol => {
    const body = `\uFEFF# body${eol}untouched${eol}`
    const next = edit(body, { kind: 'set', key: 'a', value: 'v', type: 'text' })
    expect(next).toBe(`\uFEFF---${eol}a: v${eol}---${eol}# body${eol}untouched${eol}`)
    expect(edit(next, { kind: 'remove', key: 'a' })).toBe(body)
  })
  it('原始碼驗證、替換不動內文與 fence', () => {
    expect(() => validatePropertySource('a: [')).toThrow()
    expect(() => validatePropertySource('- a')).toThrow()
    expect(edit('---\r\na: 1\r\n...\r\nbody\r\n', { kind: 'replaceSource', yaml: 'b: true\n# comment' })).toBe('---\r\nb: true\r\n# comment\r\n...\r\nbody\r\n')
    expect(() => edit('body', { kind: 'replaceSource', yaml: 'a: [' })).toThrow()
  })
  it('重複 key、改名衝突與不支援格式不能悄悄寫壞', () => {
    expect(() => edit('---\na: 1\na: 2\n---\n', { kind: 'remove', key: 'a' })).toThrow()
    expect(() => edit('---\na: 1\nb: 2\n---\n', { kind: 'rename', key: 'a', newKey: 'b' })).toThrow()
    expect(() => edit('---\na:\n  b: c\n---\n', { kind: 'set', key: 'a', value: 'x', type: 'text' })).toThrow()
    expect(edit('body', { kind: 'remove', key: 'a' })).toBe('body')
  })
})

describe('型別與列表', () => {
  it('八種型別及優先順序', () => {
    for (const [type, value] of cases) expect(inferPropertyType(type === 'tags' || type === 'aliases' ? type : 'key', value)).toBe(type)
    expect(inferPropertyType('cssclasses', 'x')).toBe('multitext')
    expect(inferPropertyType('tags', true, { tags: 'text' })).toBe('text')
    expect(inferPropertyType('x', 'a', { x: 'date' })).toBe('date')
    expect(inferPropertyType('x', {}, { x: 'text' })).toBe('unsupported')
    expect(inferPropertyType('x', [{ a: 1 }])).toBe('unsupported')
  })
  it('多行、巢狀與 flow 根節點唯讀；空字串無屬性', () => {
    expect(listProperties('')).toEqual([])
    const properties = listProperties('---\na: |\n  line\nb: {x: 1}\nc: [1, {x: 2}]\n---\n')
    expect(properties.map(item => item.type)).toEqual(['unsupported', 'unsupported', 'unsupported'])
    expect(properties.every(item => !item.editable)).toBe(true)
    expect(listProperties('---\n{a: 1}\n---\n')[0].editable).toBe(false)
  })
})

describe('保守處理多行與特殊 YAML', () => {
  it('跨實體行的純量也唯讀', () => {
    expect(listProperties('---\na: first\n  second\nb: "first\n  second"\n---\n').map(p => p.editable)).toEqual([false, false])
  })
  it.each(['\n', '\r\n'])('有錨點或別名的屬性唯讀，改其他 key 保留原文 %j', eol => {
    const content = `---${eol}a: &shared [one, two]${eol}b: *shared${eol}c: old${eol}---${eol}body`
    expect(listProperties(content.slice(0, content.indexOf('body'))).slice(0, 2).map(p => p.editable)).toEqual([false, false])
    expect(edit(content, { kind: 'set', key: 'c', type: 'text', value: 'new' })).toBe(content.replace('c: old', 'c: new'))
  })
})

describe('flow 清單保持原本寫法（只改 UI，格式不動）', () => {
  it.each(['\n', '\r\n'])('改 tags: [a, b] 仍是 flow，行尾註解保留 %j', eol => {
    const content = `---${eol}tags: [notegen, phase-2]  # 註解${eol}other: 1${eol}---${eol}body`
    expect(edit(content, { kind: 'set', key: 'tags', type: 'tags', value: ['notegen', 'phase-2', 'x'] }))
      .toBe(`---${eol}tags: [notegen, phase-2, x]  # 註解${eol}other: 1${eol}---${eol}body`)
    expect(edit(content, { kind: 'set', key: 'tags', type: 'tags', value: [] }))
      .toBe(`---${eol}tags: []  # 註解${eol}other: 1${eol}---${eol}body`)
  })
  it('項目含逗號或括號時加引號，block 清單維持逐行寫法', () => {
    expect(edit('---\na: [x]\n---\n', { kind: 'set', key: 'a', type: 'multitext', value: ['x', 'y, z', '[[連結]]'] }))
      .toBe('---\na: [x, "y, z", "[[連結]]"]\n---\n')
    expect(edit('---\na:\n  - x\n---\n', { kind: 'set', key: 'a', type: 'multitext', value: ['x', 'y'] }))
      .toBe('---\na:\n  - x\n  - y\n---\n')
  })
})

describe('applyFrontmatterEditToBlock（編輯器卡片用）', () => {
  it('只回傳區塊，改值時其他行原樣', () => {
    const block = '---\ntitle: "a: b"  # 註解\ndone: false\n\nz: 1\n---\n'
    expect(applyFrontmatterEditToBlock(block, { kind: 'set', key: 'done', type: 'checkbox', value: true }))
      .toBe(block.replace('done: false', 'done: true'))
  })
  it('刪掉最後一個屬性回傳空字串，呼叫端據此移除節點', () => {
    expect(applyFrontmatterEditToBlock('---\na: 1\n---\n', { kind: 'remove', key: 'a' })).toBe('')
  })
  it('沒有結尾換行的區塊（檔尾）也能改', () => {
    expect(applyFrontmatterEditToBlock('---\na: 1\n---', { kind: 'set', key: 'a', type: 'number', value: 2 })).toBe('---\na: 2\n---')
  })
  it('非 frontmatter 內容會丟錯', () => {
    expect(() => applyFrontmatterEditToBlock('body', { kind: 'remove', key: 'a' })).toThrow()
  })
  it('yamlScalarText 為特殊字元加引號', () => {
    expect(yamlScalarText('筆記')).toBe('筆記')
    expect(yamlScalarText('a: b')).toBe('"a: b"')
    expect(yamlScalarText('true')).toBe('"true"')
  })
})
