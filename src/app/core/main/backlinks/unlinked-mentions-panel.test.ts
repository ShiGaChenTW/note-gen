// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { indexNote } from '@/lib/vault-index/index-note'
import { clearUnlinkedMentionsCache } from '@/lib/vault-index/unlinked-mentions-scan'
import useVaultIndexStore from '@/stores/vault-index'
import messages from '../../../../../messages/zh-TW.json'

const { reveal, activate, readNote, rewriteNote, toast, files } = vi.hoisted(() => ({
  reveal: vi.fn(), activate: vi.fn(), readNote: vi.fn(), rewriteNote: vi.fn(), toast: vi.fn(),
  files: new Map<string, string>(),
}))
const article = create(() => ({ activeFilePath: 'Target.md', setActiveFilePath: activate }))
vi.mock('@/stores/article', () => ({ default: article }))
vi.mock('@/lib/daily/note-io', () => ({ revealInFileTree: reveal, readNote }))
vi.mock('@/lib/note-rewrite', () => ({ rewriteNote }))
vi.mock('@/hooks/use-toast', () => ({ toast }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: keyof typeof messages.backlinks) => messages.backlinks[key] }))

const { default: BacklinksPanel } = await import('./backlinks-panel')
let container: HTMLDivElement
let root: Root
const t = messages.backlinks

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  article.setState({ activeFilePath: 'Target.md' })
  clearUnlinkedMentionsCache()
  files.clear()
  files.set('Target.md', '---\naliases: [別名]\n---\n')
  files.set('folder/Source.md', '第一行\n提到 target 與 別名\n[[Target]] 已連結\n')
  files.set('Other.md', '也提到 Target\n')
  files.set('None.md', '沒有\n')
  readNote.mockReset().mockImplementation(async (path: string) => files.get(path) ?? null)
  rewriteNote.mockReset().mockImplementation(async (path: string, rewrite: (content: string) => string | null) => {
    const next = rewrite(files.get(path)!)
    if (next !== null) files.set(path, next)
    return next === null ? null : { path, content: next, previousContent: '' }
  })
  toast.mockReset()
  reveal.mockReset()
  activate.mockReset()
  const store = useVaultIndexStore.getState()
  store.reset('test')
  store.replaceAll(new Map([...files].map(([path, text]) => [path, indexNote(path, text, 1)])))
  store.setStatus('ready')
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render() {
  await act(async () => root.render(React.createElement(BacklinksPanel)))
}
function details(): HTMLDetailsElement {
  return container.querySelectorAll('details')[1] as HTMLDetailsElement
}
async function expand() {
  await act(async () => {
    details().open = true
    details().dispatchEvent(new Event('toggle', { bubbles: false }))
  })
  await act(async () => { await Promise.resolve() })
}
function buttons(label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(button => button.textContent === label) as HTMLButtonElement[]
}

describe('unlinked mentions section', () => {
  it('第三區預設收合、不掃描；展開才掃描並顯示分組、數量與強調文字', async () => {
    await render()
    expect(details().open).toBe(false)
    expect(details().querySelector('summary')?.textContent?.trim()).toBe(t.unlinked)
    expect(readNote).not.toHaveBeenCalled()
    await expand()
    expect(readNote.mock.calls.map(([path]) => path).sort()).toEqual(['None.md', 'Other.md', 'folder/Source.md'])
    expect(details().querySelector('summary')?.textContent).toBe(`${t.unlinked} 3`)
    expect([...details().querySelectorAll('h3')].map(h => h.textContent)).toEqual(['Other', 'Source'])
    expect(details().textContent).toContain('folder')
    expect([...details().querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['Target', 'target', '別名'])
    expect(buttons(t.linkOne)).toHaveLength(3)
    expect(buttons(t.linkAll)).toHaveLength(2)
    expect(container.querySelector('h2')?.textContent).toBe(`${t.linked} 1`)
  })

  it('點上下文開啟來源筆記', async () => {
    await render()
    await expand()
    const context = [...details().querySelectorAll('button')].find(button => button.querySelector('mark'))!
    await act(async () => context.click())
    expect(reveal).toHaveBeenCalledWith('Other.md')
    expect(activate).toHaveBeenCalledWith('Other.md')
  })

  it('「連結」改寫那一筆（別名寫 [[Target|別名]]），其他行一字不差，成功後從清單移除', async () => {
    await render()
    await expand()
    await act(async () => buttons(t.linkOne)[2].click())
    expect(rewriteNote).toHaveBeenCalledWith('folder/Source.md', expect.any(Function))
    expect(files.get('folder/Source.md')).toBe('第一行\n提到 target 與 [[Target|別名]]\n[[Target]] 已連結\n')
    expect(toast).toHaveBeenCalledWith({ title: t.linkDone })
    expect([...details().querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['Target', 'target'])
    expect(details().querySelector('summary')?.textContent).toBe(`${t.unlinked} 2`)
  })

  it('「全部連結」由後往前一次改完整篇，清空的群組消失；同名時寫完整路徑', async () => {
    files.set('dup/Target.md', '')
    useVaultIndexStore.getState().upsert([indexNote('dup/Target.md', '', 1)])
    await render()
    await expand()
    await act(async () => buttons(t.linkAll)[1].click())
    expect(files.get('folder/Source.md')).toBe('第一行\n提到 [[Target|target]] 與 [[Target|別名]]\n[[Target]] 已連結\n')
    expect([...details().querySelectorAll('h3')].map(h => h.textContent)).toEqual(['Other'])
    await act(async () => buttons(t.linkAll)[0].click())
    expect(files.get('Other.md')).toBe('也提到 [[Target]]\n')
    expect(details().textContent).toContain(t.unlinkedEmpty)
  })

  it('改寫失敗時提示並保留清單', async () => {
    rewriteNote.mockRejectedValueOnce(new Error('conflict'))
    await render()
    await expand()
    await act(async () => buttons(t.linkOne)[0].click())
    expect(toast).toHaveBeenCalledWith({ title: t.linkFailed, variant: 'destructive' })
    expect(buttons(t.linkOne)).toHaveLength(3)
  })

  it('索引 revision 變了不自動重掃，出現「掃描」按鈕；按了才重掃', async () => {
    await render()
    await expand()
    readNote.mockClear()
    await act(async () => useVaultIndexStore.getState().upsert([indexNote('None.md', 'Target 新提及', 2)]))
    expect(readNote).not.toHaveBeenCalled()
    expect(buttons(t.scan)).toHaveLength(1)
    files.set('None.md', 'Target 新提及\n')
    await act(async () => buttons(t.scan)[0].click())
    await act(async () => { await Promise.resolve() })
    expect(buttons(t.scan)).toHaveLength(0)
    expect(details().querySelector('summary')?.textContent).toBe(`${t.unlinked} 4`)
  })
})
