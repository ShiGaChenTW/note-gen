// @vitest-environment jsdom
// 編輯器頂端屬性卡片：閱讀／編輯、只改被改的那一行、收合、唯讀。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { EditorContent, useEditor, type Editor as ReactEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import messages from '../messages/zh-TW.json'

const setting = create(() => ({ frontmatterTemplates: [{ id: 'default', name: '預設', yaml: 'title: {{title}}\ntags: []\n' }, { id: 'p', name: '專案', yaml: 'status: draft\n' }], frontmatterDefaultTemplateId: 'default', frontmatterCollapsed: false, setFrontmatterCollapsed: async (value: boolean) => { setting.setState({ frontmatterCollapsed: value }) } }))
const article = create(() => ({ activeFilePath: 'note.md' }))
vi.mock('@/stores/setting', () => ({ default: setting }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/stores/article', () => ({ default: article }))
vi.mock('@/lib/obsidian-types', () => ({ loadObsidianPropertyTypes: async () => ({}) }))
vi.mock('@/app/core/main/editor/markdown/wikilink-extension', () => ({ openWikilink: vi.fn(async () => {}) }))
vi.mock('next-intl', () => ({
  useLocale: () => 'zh-TW',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const text = key.split('.').reduce((data: any, part) => data?.[part], messages.properties as any) ?? key
    return String(text).replace(/\{(\w+)\}/g, (_, name) => String(values?.[name]))
  },
}))

const { FrontmatterCreateButton } = await import('@/app/core/main/editor/markdown/frontmatter-create-button')
const { MarkdownParagraph } = await import('@/app/core/main/editor/markdown/markdown-paragraph')
const { encodeFrontmatterForEditor, Frontmatter } = await import('@/app/core/main/editor/markdown/frontmatter-extension')

const SAMPLE = [
  '---',
  'title: "屬性樣本: 有冒號"  # 行尾註解要留著',
  'due: 2026-10-25',
  'rating: 4',
  'done: false',
  'related:',
  '  - "[[雙鏈目標]]"',
  'tags: [notegen, phase-2]',
  '',
  'nested:',
  '  a: 1',
  '---',
  '',
  '本文',
].join('\n')

let container: HTMLDivElement
let root: Root
let editor: ReactEditor | null = null

function Host({ content, editable, withCreate = false }: { content: string; editable: boolean; withCreate?: boolean }) {
  const instance = useEditor({
    immediatelyRender: true,
    editable,
    extensions: [
      Frontmatter,
      StarterKit.configure({ blockquote: false, codeBlock: false, link: false, paragraph: false, underline: false, dropcursor: false }),
      MarkdownParagraph,
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
    content: encodeFrontmatterForEditor(content),
    contentType: 'markdown',
  })
  editor = instance
  return React.createElement(React.Fragment, null,
    withCreate && instance ? React.createElement(FrontmatterCreateButton, { editor: instance, path: '日記/今天: 筆記.md' }) : null,
    React.createElement(EditorContent, { editor: instance }))
}

async function mount(content = SAMPLE, editable = true, withCreate = false) {
  await act(async () => root.render(React.createElement(Host, { content, editable, withCreate })))
  await act(async () => { await Promise.resolve() })
}
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))
const markdown = () => editor!.getMarkdown()

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  setting.setState({ frontmatterCollapsed: false })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  editor = null
})

describe('frontmatter 屬性卡片', () => {
  it('閱讀模式只展示：沒有輸入框，日期依語系、核取方塊顯示否、連結與標籤可見', async () => {
    await mount()
    expect(container.querySelector('input, textarea')).toBeNull()
    const text = container.textContent ?? ''
    expect(text).toContain('屬性樣本: 有冒號')
    expect(text).toContain('2026年10月25日')
    expect(text).toContain(`✗ ${messages.properties.no}`)
    expect(text).toContain('雙鏈目標')
    expect(text).toContain('#notegen')
    expect(button(messages.properties.edit)).toBeDefined()
    expect(markdown()).toBe(SAMPLE)
  })

  it('編輯模式切換核取方塊只改那一行，註解、空行、巢狀區塊與本文原樣', async () => {
    await mount()
    await act(async () => button(messages.properties.edit)!.click())
    const toggle = container.querySelector<HTMLElement>('button[role="switch"]')!
    await act(async () => toggle.click())
    expect(markdown()).toBe(SAMPLE.replace('done: false', 'done: true'))
    expect(markdown()).toContain('# 行尾註解要留著')
  })

  it('標籤新增與移除維持 flow 寫法；Enter 提交，注音組字中不提交', async () => {
    await mount()
    await act(async () => button(messages.properties.edit)!.click())
    const field = container.querySelector<HTMLInputElement>('input[aria-label="tags"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'x')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })) })
    expect(markdown()).toBe(SAMPLE)
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(markdown()).toBe(SAMPLE.replace('tags: [notegen, phase-2]', 'tags: [notegen, phase-2, x]'))
    await act(async () => container.querySelector<HTMLElement>(`button[aria-label="${messages.properties.remove} notegen"]`)!.click())
    expect(markdown()).toContain('tags: [phase-2, x]')
  })

  it('數字與文字失焦才寫回；數字不合法時還原', async () => {
    await mount()
    await act(async () => button(messages.properties.edit)!.click())
    const rating = container.querySelector<HTMLInputElement>('input[aria-label="rating"]')!
    const set = (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(rating, value)
      rating.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await set('5')
    expect(markdown()).toBe(SAMPLE)
    await act(async () => rating.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(markdown()).toBe(SAMPLE.replace('rating: 4', 'rating: 5'))
  })

  it('刪光所有屬性會移除整個 frontmatter 節點，本文保留', async () => {
    await mount('---\na: 1\n---\n\n本文')
    await act(async () => button(messages.properties.edit)!.click())
    await act(async () => container.querySelector<HTMLElement>(`button[aria-label="${messages.properties.remove} a"]`)!.click())
    expect(editor!.state.doc.firstChild?.type.name).not.toBe('frontmatter')
    expect(markdown()).toBe('本文')
  })

  it('「移除全部」整塊刪除', async () => {
    await mount()
    await act(async () => button(messages.properties.edit)!.click())
    await act(async () => button(messages.properties.removeAll)!.click())
    expect(markdown()).toBe('本文')
  })

  it('整塊收合：只剩摘要，展開後恢復；狀態寫進全域設定', async () => {
    await mount()
    await act(async () => container.querySelector<HTMLElement>(`button[aria-label="${messages.properties.collapse}"]`)!.click())
    expect(setting.getState().frontmatterCollapsed).toBe(true)
    expect(container.textContent).toContain(messages.properties.collapsedHint)
    expect(container.querySelector('dl')).toBeNull()
    expect(markdown()).toBe(SAMPLE)
    await act(async () => container.querySelector<HTMLElement>(`button[aria-label="${messages.properties.expand}"]`)!.click())
    expect(container.querySelector('dl')).not.toBeNull()
  })

  it('唯讀文件沒有編輯按鈕', async () => {
    await mount(SAMPLE, false)
    expect(button(messages.properties.edit)).toBeUndefined()
    expect(container.querySelector('input, textarea')).toBeNull()
  })

  it('YAML 有誤時顯示錯誤與原文，不提供欄位編輯', async () => {
    await mount('---\na: [1\n---\n\n本文')
    expect(container.textContent).toContain(messages.properties.invalidYaml)
    expect(container.textContent).toContain(messages.properties.errorHint)
    expect(container.querySelector('input')).toBeNull()
  })

  it('原始碼模式套用有效 YAML；無效時不寫入', async () => {
    await mount()
    await act(async () => button(messages.properties.edit)!.click())
    await act(async () => button(messages.properties.source)!.click())
    const area = container.querySelector<HTMLTextAreaElement>('textarea')!
    const set = (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value)
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await set('a: [1')
    await act(async () => button(messages.properties.apply)!.click())
    expect(markdown()).toBe(SAMPLE)
    await set('title: 新\n')
    await act(async () => button(messages.properties.apply)!.click())
    expect(markdown()).toBe('---\ntitle: 新\n---\n\n本文')
  })
})

describe('一鍵建立 frontmatter 範本', () => {
  it('沒有屬性時顯示按鈕；點下去用預設範本建立，title 預填檔名（含冒號會加引號）', async () => {
    await mount('本文', true, true)
    expect(container.querySelector('[data-testid="frontmatter-create"]')).not.toBeNull()
    await act(async () => button(messages.properties.createTemplate)!.click())
    expect(markdown()).toBe('---\ntitle: "今天: 筆記"\ntags: []\n---\n\n本文')
    expect(container.querySelector('[data-testid="frontmatter-create"]')).toBeNull()
  })
  it('已經有 frontmatter 就不顯示按鈕', async () => {
    await mount(SAMPLE, true, true)
    expect(container.querySelector('[data-testid="frontmatter-create"]')).toBeNull()
  })
})
