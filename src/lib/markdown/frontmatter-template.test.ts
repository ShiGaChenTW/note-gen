import { describe, expect, it } from 'vitest'
import { listProperties } from './frontmatter-edit'
import {
  DEFAULT_FRONTMATTER_TEMPLATES, normalizeFrontmatterTemplates, pickDefaultTemplate,
  renderFrontmatterBlock, titleFromPath, validateTemplateYaml,
} from './frontmatter-template'

const now = new Date(2026, 9, 24, 8, 5)

describe('frontmatter 範本', () => {
  it('套用 title、date、datetime 變數，輸出完整區塊', () => {
    const block = renderFrontmatterBlock({ yaml: 'title: {{title}}\ncreated: {{date}}\nat: {{ datetime }}\ntags: []' }, { title: '今天的筆記', now })
    expect(block).toBe('---\ntitle: 今天的筆記\ncreated: 2026-10-24\nat: 2026-10-24T08:05\ntags: []\n---\n')
  })
  it('檔名含冒號或井號時加引號，結果仍是合法 YAML', () => {
    const block = renderFrontmatterBlock({ yaml: 'title: {{title}}\n' }, { title: '計畫: A # 版', now })
    expect(listProperties(block)[0].value).toBe('計畫: A # 版')
  })
  it('空範本不產生區塊，CRLF 與缺結尾換行會被正規化', () => {
    expect(renderFrontmatterBlock({ yaml: '  \n' }, { title: 'x', now })).toBe('')
    expect(renderFrontmatterBlock({ yaml: 'a: 1\r\nb: 2' }, { title: 'x', now })).toBe('---\na: 1\nb: 2\n---\n')
  })
  it('內建範本都能通過驗證，壞範本回傳錯誤訊息', () => {
    for (const template of DEFAULT_FRONTMATTER_TEMPLATES) expect(validateTemplateYaml(template.yaml)).toBe('')
    expect(validateTemplateYaml('a: [1\nb: 2')).not.toBe('')
    expect(validateTemplateYaml('- 清單不是對應表')).not.toBe('')
  })
  it('titleFromPath 去掉資料夾與副檔名', () => {
    expect(titleFromPath('日記/2026-10-24.md')).toBe('2026-10-24')
    expect(titleFromPath('a\\b\\c.MD')).toBe('c')
    expect(titleFromPath('無副檔名')).toBe('無副檔名')
  })
  it('儲存值格式不對時回到預設；重複 id 與壞項目被丟掉', () => {
    expect(normalizeFrontmatterTemplates(undefined)).toEqual(DEFAULT_FRONTMATTER_TEMPLATES)
    expect(normalizeFrontmatterTemplates([])).toEqual(DEFAULT_FRONTMATTER_TEMPLATES)
    expect(normalizeFrontmatterTemplates([{ id: 'a', name: 'A', yaml: 'x: 1' }, { id: 'a', name: 'B', yaml: '' }, { id: 3 }, null]))
      .toEqual([{ id: 'a', name: 'A', yaml: 'x: 1' }])
  })
  it('預設範本找不到時用第一個', () => {
    const list = [{ id: 'a', name: 'A', yaml: '' }, { id: 'b', name: 'B', yaml: '' }]
    expect(pickDefaultTemplate(list, 'b')?.id).toBe('b')
    expect(pickDefaultTemplate(list, 'zzz')?.id).toBe('a')
    expect(pickDefaultTemplate([], 'a')).toBeUndefined()
  })
})
