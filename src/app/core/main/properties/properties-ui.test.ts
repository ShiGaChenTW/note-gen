// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import messages from '../../../../../messages/zh-TW.json'
import { indexNote } from '@/lib/vault-index/index-note'
import useVaultIndexStore from '@/stores/vault-index'

const { rewrite } = vi.hoisted(() => ({ rewrite: vi.fn() }))
const article = create(() => ({ activeFilePath: 'note.md', currentArticle: '' }))
vi.mock('@/stores/article', () => ({ default: article }))
vi.mock('@/lib/note-rewrite', () => ({ rewriteNote: rewrite }))
vi.mock('@/lib/obsidian-types', () => ({ loadObsidianPropertyTypes: async () => ({ rating: 'number' }) }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key.split('.').reduce((data, part) => data[part], messages.properties as unknown as Record<string, any>) }))
const { default: PropertiesPanel } = await import('./properties-panel')
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  article.setState({ activeFilePath: 'note.md', currentArticle: '' })
  useVaultIndexStore.getState().reset('test')
  rewrite.mockReset().mockImplementation(async (path: string, fn: (content: string) => string) => {
    const content = fn(article.getState().currentArticle)
    article.setState({ currentArticle: content })
    return { path, content }
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(content = '') {
  article.setState({ currentArticle: content })
  await act(async () => root.render(React.createElement(PropertiesPanel)))
}
function button(label: string) { return [...container.querySelectorAll('button')].find(b => b.textContent === label)! }
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(element: HTMLElement) { await act(async () => element.click()) }

describe('屬性面板互動', () => {
  it('未開 Markdown 顯示提示，切換筆記後重設原始碼模式', async () => {
    article.setState({ activeFilePath: 'image.png' })
    await render()
    expect(container.textContent).toContain(messages.properties.notMarkdown)
    await act(async () => article.setState({ activeFilePath: 'note.md' }))
    expect(container.textContent).toContain(messages.properties.empty)
    await click(button(messages.properties.source))
    expect(container.querySelector('textarea')).not.toBeNull()
    await act(async () => article.setState({ activeFilePath: 'other.md' }))
    expect(container.querySelector('textarea')).toBeNull()
  })
  it('原始 YAML 先驗證，錯誤不寫；成功透過 rewriteNote 保留 CRLF 內文', async () => {
    await render('---\r\na: 1\r\n---\r\n原樣\r\nkey:: value')
    await click(button(messages.properties.source))
    await input(container.querySelector('textarea')!, 'a: [')
    await click(button(messages.properties.apply))
    expect(rewrite).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(messages.properties.invalidYaml)
    await input(container.querySelector('textarea')!, 'a: 2')
    await click(button(messages.properties.apply))
    expect(rewrite.mock.calls[0][0]).toBe('note.md')
    expect(article.getState().currentArticle).toBe('---\r\na: 2\r\n---\r\n原樣\r\nkey:: value')
  })
  it('新增依 types.json 設定型別，提供 vault key 建議', async () => {
    useVaultIndexStore.getState().replaceAll(new Map([['a.md', indexNote('a.md', '---\nrating: 2\n---\n', 1)]]))
    await render()
    await click(button(messages.properties.add))
    const field = container.querySelector('input')!
    await input(field, 'rating')
    expect(container.querySelector('option[value="rating"]')).not.toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('[aria-label="屬性型別"]')?.textContent).toBe(messages.properties.types.number)
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(article.getState().currentArticle).toBe('---\nrating: 0\n---\n')
  })
  it('chip 的 Enter 新增、移除及核取方塊只改對應 key', async () => {
    const tail = 'keep: "原樣" # 註解\n---\nbody\n'
    await render('---\ntags: [old]\ndone: false\n' + tail)
    const field = container.querySelector('input[aria-label="tags"]')!
    await input(field as HTMLInputElement, 'new')
    await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(article.getState().currentArticle).toBe('---\ntags: [old, new]\ndone: false\n' + tail)
    await click(container.querySelector(`button[aria-label="${messages.properties.remove} old"]`)!)
    await click(container.querySelector('[role="checkbox"]')!)
    expect(article.getState().currentArticle).toBe('---\ntags: [new]\ndone: true\n' + tail)
  })
  it('數字失焦寫回、雙擊改名，保留未觸及的行', async () => {
    const tail = 'keep: "原樣" # 註解\n---\nbody'
    await render('---\ncount: 1\n' + tail)
    const field = container.querySelector('input[aria-label="count"]') as HTMLInputElement
    await act(async () => field.focus())
    await input(field, '2.5')
    await act(async () => field.blur())
    expect(article.getState().currentArticle).toBe('---\ncount: 2.5\n' + tail)
    await act(async () => button('count').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const name = container.querySelector(`input[aria-label="${messages.properties.rename}"]`) as HTMLInputElement
    await input(name, 'rating')
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(article.getState().currentArticle).toBe('---\nrating: 2.5\n' + tail)
  })
  it('巢狀資料唯讀並保留原文，寫回失敗保留輸入與顯示錯誤', async () => {
    await render('---\nnested: {a: 1}\n---\nbody')
    expect(container.querySelector('pre')?.textContent).toBe('nested: {a: 1}')
    expect(container.textContent).toContain(messages.properties.unsupported)
    expect(button('nested').disabled).toBe(true)
    expect((container.querySelector('button[aria-label="nested"]') as HTMLButtonElement).disabled).toBe(true)
    await click(button(messages.properties.source))
    await input(container.querySelector('textarea')!, 'a: 2')
    rewrite.mockRejectedValue(new Error('conflict'))
    await click(button(messages.properties.apply))
    expect(container.querySelector('textarea')?.value).toBe('a: 2')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(messages.properties.saveFailed)
    expect(article.getState().currentArticle).toBe('---\nnested: {a: 1}\n---\nbody')
  })
})
