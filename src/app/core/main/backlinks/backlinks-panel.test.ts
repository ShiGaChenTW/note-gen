// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { indexNote } from '@/lib/vault-index/index-note'
import useVaultIndexStore from '@/stores/vault-index'
import messages from '../../../../../messages/zh-TW.json'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'

const { reveal, activate, order } = vi.hoisted(() => ({
  reveal: vi.fn(), activate: vi.fn(), order: [] as string[],
}))
const article = create(() => ({ activeFilePath: 'Target.md', setActiveFilePath: activate }))
vi.mock('@/stores/article', () => ({ default: article }))
vi.mock('@/lib/daily/note-io', () => ({ revealInFileTree: reveal, readNote: vi.fn(async () => null) }))
vi.mock('@/lib/note-rewrite', () => ({ rewriteNote: vi.fn() }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: keyof typeof messages.backlinks) => messages.backlinks[key] }))

// 動態載入，讓 mock store 先完成初始化。
const { default: BacklinksPanel } = await import('./backlinks-panel')
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  article.setState({ activeFilePath: 'Target.md' })
  useVaultIndexStore.getState().reset('test')
  order.length = 0
  reveal.mockReset().mockImplementation(async () => { order.push('reveal') })
  activate.mockReset().mockImplementation(async () => { order.push('activate') })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render() {
  await act(async () => root.render(React.createElement(BacklinksPanel)))
}
function ready(contents: Array<[string, string]>) {
  useVaultIndexStore.getState().replaceAll(new Map(contents.map(([path, text]) => [path, indexNote(path, text, 1)])))
  useVaultIndexStore.getState().setStatus('ready')
}

describe('backlinks panel', () => {
  it('provides all translations after today and linkRewrite in every locale', () => {
    for (const locale of [messages, en, zh]) {
      // 2-1 的七個 key 在前，2-2 L4 的八個 key 追加在 backlinks 物件尾端
      expect(Object.keys(locale.backlinks)).toEqual([
        'title', 'linked', 'outgoing', 'empty', 'indexing', 'notMarkdown', 'unresolved',
        'unlinked', 'scan', 'scanning', 'linkOne', 'linkAll', 'unlinkedEmpty', 'linkDone', 'linkFailed',
      ])
      expect(Object.values(locale.backlinks).every(value => value.trim().length > 0)).toBe(true)
      const namespaces = Object.keys(locale)
      // 2-2 L7 的 linkRewrite 插在 today 之後、backlinks 之前
      expect(namespaces.slice(namespaces.indexOf('today') + 1, namespaces.indexOf('today') + 3)).toEqual(['linkRewrite', 'backlinks'])
    }
  })

  it('shows no-file and non-Markdown hints, indexing status and the ready empty state', async () => {
    article.setState({ activeFilePath: '' })
    await render()
    expect(container.textContent).toContain(messages.backlinks.notMarkdown)
    await act(async () => article.setState({ activeFilePath: 'image.png' }))
    expect(container.textContent).toContain(messages.backlinks.notMarkdown)
    await act(async () => article.setState({ activeFilePath: 'Target.md' }))
    expect(container.querySelector('[role="status"]')?.textContent).toBe(messages.backlinks.indexing)
    await act(async () => ready([['Target.md', '']]))
    expect(container.textContent).toContain(messages.backlinks.empty)
  })

  it('groups sources, highlights raw wikilinks and markdown text, counts outgoing and marks unresolved targets', async () => {
    ready([['Target.md', '[[Missing]] [[Other]]'], ['folder/Source.md', '前 [[Target|別名]] 後\n文字前 [文字](../Target.md)'], ['Other.md', '']])
    await render()
    expect(container.querySelectorAll('h3')).toHaveLength(1)
    expect(container.textContent).toContain('Sourcefolder')
    expect([...container.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['[[Target|別名]]', '文字'])
    expect(container.querySelectorAll('mark')[1].previousSibling?.textContent).toBe('文字前 [')
    expect(container.querySelector('h2')?.textContent).toBe(`${messages.backlinks.linked} 2`)
    expect(container.querySelector('summary')?.textContent).toBe(`${messages.backlinks.outgoing} 2`)
    expect(container.textContent?.split(messages.backlinks.unresolved)).toHaveLength(2)
    const details = container.querySelector('details')!
    expect(details.open).toBe(true)
    details.open = false
    expect(details.open).toBe(false)
  })

  it('reveals the source before activating it and reacts to index and active-file changes', async () => {
    ready([['Target.md', ''], ['folder/Source.md', '[[Target]]']])
    await render()
    await act(async () => container.querySelector('button')!.click())
    expect(reveal).toHaveBeenCalledWith('folder/Source.md')
    expect(activate).toHaveBeenCalledWith('folder/Source.md')
    expect(order).toEqual(['reveal', 'activate'])
    await act(async () => useVaultIndexStore.getState().upsert([indexNote('folder/Source.md', '', 2)]))
    expect(container.textContent).toContain(messages.backlinks.empty)
    await act(async () => article.setState({ activeFilePath: 'image.png' }))
    expect(container.textContent).toContain(messages.backlinks.notMarkdown)
  })
})
