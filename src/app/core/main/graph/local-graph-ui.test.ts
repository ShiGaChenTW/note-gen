// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { indexNote } from '@/lib/vault-index/index-note'
import useVaultIndexStore from '@/stores/vault-index'
const article = create(() => ({ activeFilePath: 'a.md', setActiveFilePath: vi.fn() }))
const reveal = vi.fn()
let flow: Record<string, any>
vi.mock('@/stores/article', () => ({ default: article }))
vi.mock('@/lib/daily/note-io', () => ({ revealInFileTree: reveal }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: Record<string, any>) => { flow = props; return React.createElement('div', { 'data-flow': true }) },
  MarkerType: { ArrowClosed: 'arrowclosed' }, Handle: () => null, Position: { Top: 'top', Bottom: 'bottom' },
  useReactFlow: () => ({ fitView: vi.fn() }),
}))
vi.mock('@/lib/vault-index/graph', async importOriginal => ({
  ...await importOriginal<object>(),
  layoutLocalGraph: async (graph: { nodes: { id: string }[] }) => new Map(graph.nodes.map(node => [node.id, { x: 10, y: 20 }])),
}))
const { default: Panel } = await import('./local-graph-panel')
let container: HTMLDivElement, root: Root
const note = (path: string, content = '') => indexNote(path, content, 0)
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  article.setState({ activeFilePath: 'a.md' })
  article.getState().setActiveFilePath.mockClear()
  reveal.mockReset()
  useVaultIndexStore.getState().reset('test')
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function render() { await act(async () => root.render(React.createElement(Panel))) }
describe('關聯圖面板', () => {
  it('區分非筆記、索引中與空圖狀態', async () => {
    await render(); expect(container.textContent).toContain('indexing')
    await act(async () => article.setState({ activeFilePath: 'image.png' }))
    expect(container.textContent).toContain('notMarkdown')
    await act(async () => { article.setState({ activeFilePath: 'a.md' }); useVaultIndexStore.getState().setStatus('ready') })
    expect(container.textContent).toContain('empty')
  })
  it('深度切換、索引更新、唯讀設定與開啟節點', async () => {
    useVaultIndexStore.getState().replaceAll(new Map([note('a.md', '[[b]] [[missing]]'), note('b.md', '[[c]]'), note('c.md')].map(n => [n.path, n])))
    useVaultIndexStore.getState().setStatus('ready')
    await render()
    expect(flow.nodes.map((n: { id: string }) => n.id)).toEqual(['a.md', 'b.md', 'unresolved:missing'])
    expect(flow).toMatchObject({ nodesDraggable: false, nodesConnectable: false, edgesReconnectable: false, elementsSelectable: false, deleteKeyCode: null })
    await act(async () => container.querySelectorAll('button')[1].click())
    expect(flow.nodes.at(-1).id).toBe('c.md')
    await act(async () => { await flow.onNodeClick(null, { id: 'b.md' }) })
    expect(reveal).toHaveBeenCalledWith('b.md')
    expect(article.getState().setActiveFilePath).toHaveBeenCalledWith('b.md')
    reveal.mockClear(); article.getState().setActiveFilePath.mockClear()
    await act(async () => { await flow.onNodeClick(null, { id: 'unresolved:missing' }) })
    expect(reveal).not.toHaveBeenCalled()
    expect(article.getState().setActiveFilePath).not.toHaveBeenCalled()
    await act(async () => useVaultIndexStore.getState().upsert([note('a.md', '[[new]]')]))
    expect(flow.nodes.map((n: { id: string }) => n.id)).toEqual(['a.md', 'unresolved:new'])
  })
})
