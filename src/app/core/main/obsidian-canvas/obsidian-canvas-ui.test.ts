// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactFlowProps } from '@xyflow/react'
import type { CanvasFlowNode } from '@/lib/obsidian-canvas/flow'
const h = vi.hoisted(() => ({ disk: '', read: vi.fn(), rewrite: vi.fn(), toast: vi.fn(), reveal: vi.fn(), active: vi.fn(), open: vi.fn() }))
const translate = (key: string) => key
const toastValue = { toast: h.toast }
let flow: ReactFlowProps<CanvasFlowNode>
vi.mock('next-intl', () => ({ useTranslations: () => translate }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => toastValue }))
vi.mock('@/lib/daily/note-io', () => ({ readNote: h.read, revealInFileTree: h.reveal }))
vi.mock('@/lib/note-rewrite', () => ({ rewriteNote: h.rewrite }))
vi.mock('@/stores/article', () => ({ default: { getState: () => ({ setActiveFilePath: h.active }) } }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: h.open }))
vi.mock('@xyflow/react', async original => ({
  ...await original<object>(),
  ReactFlow: (props: ReactFlowProps<CanvasFlowNode>) => { flow = props; return React.createElement('div', {}, props.nodes?.map(node => React.createElement((props.nodeTypes!.canvas as React.ComponentType<any>), { key: node.id, id: node.id, data: node.data, selected: node.selected }))) },
  Handle: () => null, NodeResizer: () => null, Background: () => null, Controls: () => null,
}))
const { default: Page } = await import('./obsidian-canvas-page')
let container: HTMLDivElement, root: Root
const raw = JSON.stringify({ nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100, text: '**文字** <script>bad</script>' }], edges: [] })
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers(); vi.clearAllMocks(); h.disk = raw
  h.read.mockImplementation(async (path: string) => path.endsWith('.canvas') ? h.disk : '筆記預覽'.repeat(100))
  h.rewrite.mockImplementation(async (path: string, fn: (raw: string) => string) => { h.disk = fn(h.disk); return { path, content: h.disk } })
  h.reveal.mockResolvedValue(undefined); h.active.mockResolvedValue(undefined); h.open.mockResolvedValue(undefined)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); await Promise.resolve(); container.remove(); vi.useRealTimers() })
async function render(active = true) { await act(async () => root.render(React.createElement(Page, { filePath: 'a.canvas', isActive: active }))) }
async function click(label: string) { await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === label)!.click()) }
describe('Canvas 頁面操作', () => {
  it('安全渲染 markdown、唯讀原始碼與未修改不寫檔', async () => {
    await render(); expect(container.querySelector('strong')?.textContent).toBe('文字'); expect(container.querySelector('script')).toBeNull()
    await click('openAsText'); expect(container.querySelector('textarea')!.value).toBe(raw); expect(container.querySelector('textarea')!.readOnly).toBe(true)
    expect(h.rewrite).not.toHaveBeenCalled()
  })
  it('新增、連邊、拖曳、縮放與刪除寫回', async () => {
    await render(); await click('addText')
    const id = flow.nodes![1].id
    await act(async () => { flow.onConnect!({ source: 'a', target: id, sourceHandle: 'source-right', targetHandle: 'target-left' }) })
    await act(async () => { flow.onNodesChange!([{ type: 'position', id: 'a', position: { x: 42.2, y: 8.1 }, dragging: true }]) })
    await act(async () => { flow.onNodesChange!([{ type: 'dimensions', id: 'a', dimensions: { width: 240, height: 160 }, resizing: true, setAttributes: true }]) })
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(JSON.parse(h.disk).nodes[0]).toMatchObject({ x: 42, y: 8, width: 240, height: 160 })
    expect(JSON.parse(h.disk).edges[0]).toMatchObject({ fromSide: 'right', toSide: 'left', toEnd: 'arrow' })
    await act(async () => { flow.onNodesChange!([{ type: 'select', id: flow.nodes![1].id, selected: true }]) })
    await click('delete'); await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(JSON.parse(h.disk).nodes).toHaveLength(1); expect(JSON.parse(h.disk).edges).toEqual([])
  })
  it('重新啟用讀取外部修改，有未存內容則保留並 toast', async () => {
    await render(); await render(false); h.disk = raw.replace('文字', '外部'); await render()
    expect(container.querySelector('strong')?.textContent).toBe('外部')
    await click('addText'); await render(false); h.disk += ' '; await render()
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'externalChange' }))
    expect(flow.nodes).toHaveLength(2); expect(flow.nodesDraggable).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(500)); expect(h.rewrite).not.toHaveBeenCalled()
  })
  it('空檔錯誤與原始碼唯讀', async () => {
    h.disk = ''; await render(); expect(container.textContent).toContain('parseError'); expect(container.querySelector('textarea')!.readOnly).toBe(true)
  })
  it('檔案節點預覽、雙擊開筆記、點擊連結', async () => {
    h.disk = JSON.stringify({ nodes: [{ id: 'f', type: 'file', file: 'folder/Note.md', x: 0, y: 0, width: 200, height: 100 }, { id: 'l', type: 'link', url: 'https://example.com', x: 300, y: 0, width: 200, height: 100 }], edges: [] })
    await render(); expect(container.textContent).toContain('Note'); expect(container.textContent).toContain('筆記預覽')
    await act(async () => { container.querySelector('.border-2')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(h.reveal).toHaveBeenCalledWith('folder/Note.md'); expect(h.active).toHaveBeenCalledWith('folder/Note.md')
    await click('https://example.com'); expect(h.open).toHaveBeenCalledWith('https://example.com')
  })
  it('雙擊文字後 textarea 編輯寫回，其他內容不變', async () => {
    await render()
    await act(async () => { container.querySelector('.border-2')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const textarea = container.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '新文字\n第二行')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(JSON.parse(h.disk).nodes[0]).toEqual({ ...JSON.parse(raw).nodes[0], text: '新文字\n第二行' })
  })
})
