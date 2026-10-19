// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTagTree } from '@/lib/vault-index/tags'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import useVaultIndexStore from '@/stores/vault-index'
import messages from '../../../../../messages/zh-TW.json'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import ja from '../../../../../messages/ja.json'
import de from '../../../../../messages/de.json'
import pt from '../../../../../messages/pt-BR.json'

const { reveal, activate, order } = vi.hoisted(() => ({
  reveal: vi.fn(),
  activate: vi.fn(),
  order: [] as string[],
}))
vi.mock('@/stores/article', () => ({ default: { getState: () => ({ setActiveFilePath: activate }) } }))
vi.mock('@/lib/daily/note-io', () => ({ revealInFileTree: reveal }))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    const template = (messages.noteTags as Record<string, string>)[key] ?? key
    if (!values) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`))
  },
}))

const { default: NoteTagsSidebar, expandedPathsForQuery, toggleExpanded } = await import('./note-tags-sidebar')
let container: HTMLDivElement
let root: Root

function note(path: string, tags: string[]): IndexedNote {
  return { path, mtime: 1, frontmatter: null, tasks: [], links: [], aliases: [], tags }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  useVaultIndexStore.getState().reset('note-tags')
  order.length = 0
  reveal.mockReset().mockImplementation(async () => { order.push('reveal') })
  activate.mockReset().mockImplementation(async () => { order.push('activate') })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render() {
  await act(async () => root.render(React.createElement(NoteTagsSidebar)))
}

describe('note tag copy', () => {
  it('places noteTags after tags and at the end of navigation in every locale', () => {
    expect(messages.noteTags).toEqual({
      title: '筆記標籤',
      search: '搜尋標籤',
      sortByName: '依名稱',
      sortByCount: '依數量',
      notes: '{count} 篇筆記',
      empty: '還沒有標籤',
      indexing: '索引中…',
    })
    expect(en.noteTags).toEqual({
      title: 'Note tags',
      search: 'Search tags',
      sortByName: 'By name',
      sortByCount: 'By count',
      notes: '{count} notes',
      empty: 'No tags yet',
      indexing: 'Indexing…',
    })
    expect(zh.noteTags).toEqual({
      title: '笔记标签',
      search: '搜索标签',
      sortByName: '按名称',
      sortByCount: '按数量',
      notes: '{count} 篇笔记',
      empty: '还没有标签',
      indexing: '索引中…',
    })
    expect(ja.noteTags).toEqual({
      title: 'ノートタグ',
      search: 'タグを検索',
      sortByName: '名前順',
      sortByCount: '件数順',
      notes: '{count} 件のノート',
      empty: 'タグはまだありません',
      indexing: 'インデックス作成中…',
    })
    expect(de.noteTags).toEqual({
      title: 'Notiz-Tags',
      search: 'Tags suchen',
      sortByName: 'Nach Name',
      sortByCount: 'Nach Anzahl',
      notes: '{count} Notizen',
      empty: 'Noch keine Tags',
      indexing: 'Indizierung…',
    })
    expect(pt.noteTags).toEqual({
      title: 'Tags de notas',
      search: 'Buscar tags',
      sortByName: 'Por nome',
      sortByCount: 'Por quantidade',
      notes: '{count} notas',
      empty: 'Ainda não há tags',
      indexing: 'Indexando…',
    })
    for (const locale of [messages, en, zh, ja, de, pt]) {
      const namespaces = Object.keys(locale)
      expect(namespaces[namespaces.indexOf('tags') + 1]).toBe('noteTags')
      expect(Object.keys(locale.noteTags)).toEqual(['title', 'search', 'sortByName', 'sortByCount', 'notes', 'empty', 'indexing'])
      expect(Object.values(locale.noteTags).every(value => value.trim().length > 0)).toBe(true)
      expect(Object.keys(locale.navigation).at(-1)).toBe('noteTags')
      expect(locale.navigation.noteTags.trim().length).toBeGreaterThan(0)
    }
    expect(messages.navigation.noteTags).toBe('筆記標籤')
    expect(en.navigation.noteTags).toBe('Note tags')
    expect(zh.navigation.noteTags).toBe('笔记标签')
    expect(ja.navigation.noteTags).toBe('ノートタグ')
    expect(de.navigation.noteTags).toBe('Notiz-Tags')
    expect(pt.navigation.noteTags).toBe('Tags de notas')
  })
})

describe('expand state', () => {
  const tree = buildTagTree([
    note('a.md', ['#work/project/child']),
    note('b.md', ['#personal']),
  ])

  it('keeps manual expansion until a query forces ancestors open', () => {
    const closed = new Set<string>()
    expect([...expandedPathsForQuery(tree, '', closed)]).toEqual([])
    const opened = toggleExpanded(closed, 'work')
    expect(closed.has('work')).toBe(false)
    expect(expandedPathsForQuery(tree, '  ', opened).has('work')).toBe(true)
    const filtering = expandedPathsForQuery(tree, '#child', opened)
    expect([...filtering].sort()).toEqual(['work', 'work/project'])
    expect(filtering.has('personal')).toBe(false)
    expect(opened.has('work')).toBe(true)
    const collapsed = toggleExpanded(opened, 'work')
    expect(expandedPathsForQuery(tree, 'child', collapsed).has('work')).toBe(true)
    expect(expandedPathsForQuery(tree, '', collapsed).has('work')).toBe(false)
    const added = toggleExpanded(collapsed, 'personal')
    expect([...added].sort()).toEqual(['personal'])
  })
})

describe('note tags sidebar', () => {
  const notes: Array<[string, IndexedNote]> = [
    ['notes/alpha.md', note('notes/alpha.md', ['#alpha'])],
    ['folder/zeta-a.md', note('folder/zeta-a.md', ['#zeta'])],
    ['zeta-b.md', note('zeta-b.md', ['#Zeta/child'])],
  ]

  it('shows indexing, then the empty state', async () => {
    await render()
    expect(container.querySelector('[role="status"]')?.textContent).toBe(messages.noteTags.indexing)
    await act(async () => useVaultIndexStore.getState().setStatus('ready'))
    expect(container.textContent).toContain(messages.noteTags.empty)
    expect(container.querySelector('input')).toBeNull()
  })

  it('expands, filters, sorts, lists nested notes and opens one', async () => {
    useVaultIndexStore.getState().replaceAll(new Map(notes))
    useVaultIndexStore.getState().setStatus('ready')
    await render()

    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe(messages.noteTags.title)
    expect([...container.querySelectorAll('[role="tree"] > [role="treeitem"]')].map(row => row.getAttribute('data-tag'))).toEqual(['alpha', 'zeta'])
    expect(container.querySelector('[data-tag="zeta/child"]')).toBeNull()
    expect(container.querySelector('[data-tag="zeta"] button:not([aria-expanded])')?.textContent).toContain('2')

    const input = container.querySelector('input')!
    await act(async () => setInputValue(input, 'child'))
    expect(container.querySelector('[data-tag="alpha"]')).toBeNull()
    expect(container.querySelector('[data-tag="zeta/child"]')).not.toBeNull()
    expect(container.querySelector('[data-tag="zeta"] [aria-expanded="true"]')).not.toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('[data-tag="zeta"] button[aria-expanded]')!.click())
    expect(container.querySelector('[data-tag="zeta/child"]')).not.toBeNull()
    await act(async () => setInputValue(input, ''))
    expect(container.querySelector('[data-tag="zeta/child"]')).toBeNull()
    expect(container.querySelector('[data-tag="alpha"]')).not.toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('[data-tag="zeta"] button[aria-expanded]')!.click())
    expect(container.querySelector('[data-tag="zeta/child"]')).not.toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-pressed="false"]')!.click())
    expect([...container.querySelectorAll('[role="tree"] > [role="treeitem"]')].map(row => row.getAttribute('data-tag'))).toEqual(['zeta', 'alpha'])

    await act(async () => container.querySelector<HTMLButtonElement>('[data-tag="zeta/child"] button:not([aria-expanded])')!.click())
    expect(container.querySelector('h2')?.textContent).toBe('zeta/child 1 篇筆記')
    expect(container.querySelector('section')?.textContent).toContain('zeta-b')
    expect(container.querySelector('section')?.textContent).not.toContain('zeta-a')

    await act(async () => container.querySelector<HTMLButtonElement>('[data-tag="zeta"] button:not([aria-expanded])')!.click())
    const noteButtons = [...container.querySelectorAll<HTMLButtonElement>('section button')]
    expect(noteButtons.map(button => button.querySelector('.font-medium')?.textContent)).toEqual(['zeta-a', 'zeta-b'])
    expect(noteButtons[0].textContent).toContain('folder')
    await act(async () => noteButtons[1].click())
    expect(reveal).toHaveBeenCalledWith('zeta-b.md')
    expect(activate).toHaveBeenCalledWith('zeta-b.md')
    expect(order).toEqual(['reveal', 'activate'])
  })
})
