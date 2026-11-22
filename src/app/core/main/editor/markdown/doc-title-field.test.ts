// @vitest-environment jsdom
// Fork（almanac ALMNC-54.16）：V3 標題欄位：改名規則、Enter／下方向鍵移到內文、新文件全選、classic 不顯示。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'
import { useTitleFocusStore } from '@/lib/new-doc/title-focus'

vi.mock('../../file/rename-workspace-file', () => ({ renameWorkspaceFile: vi.fn(async () => 'renamed') }))
vi.mock('@/lib/default-filename', () => ({ generateUniqueFilename: vi.fn(async (_parent: string, base: string) => `${base}.md`) }))

const { commitDocTitle, DocTitleField, focusEditorBodyStart } = await import('./doc-title-field')

describe('commitDocTitle', () => {
  function deps(taken: string[] = []) {
    return {
      uniqueName: vi.fn(async (parent: string, base: string) => {
        let name = `${base}.md`
        for (let n = 1; taken.includes(parent ? `${parent}/${name}` : name); n++) name = `${base} (${n}).md`
        return name
      }),
      rename: vi.fn(async () => 'renamed' as const),
    }
  }

  it('renames the file to the typed title in the same folder', async () => {
    const d = deps()
    expect(await commitDocTitle('Projects/未命名.md', '  週報 ', d)).toEqual({ path: 'Projects/週報.md', status: 'renamed' })
    expect(d.rename).toHaveBeenCalledWith('Projects/未命名.md', 'Projects/週報.md')
  })

  it('keeps the current name when the title is empty or unchanged', async () => {
    const d = deps()
    expect(await commitDocTitle('未命名.md', '   ', d)).toEqual({ path: '未命名.md', status: 'unchanged' })
    expect(await commitDocTitle('未命名.md', '未命名', d)).toEqual({ path: '未命名.md', status: 'unchanged' })
    expect(d.rename).not.toHaveBeenCalled()
  })

  it('adds a number instead of overwriting an existing file', async () => {
    const d = deps(['週報.md', '週報 (1).md'])
    expect(await commitDocTitle('未命名.md', '週報', d)).toEqual({ path: '週報 (2).md', status: 'renamed' })
  })

  it('replaces illegal file-name characters with "-"', async () => {
    const d = deps()
    expect((await commitDocTitle('未命名.md', 'Q1/Q2: 計畫?', d)).path).toBe('Q1-Q2- 計畫-.md')
    expect((await commitDocTitle('未命名.md', '.env', d)).path).toBe('env.md')
  })

  it('keeps the old path when the rename does not happen', async () => {
    const d = deps()
    d.rename.mockResolvedValueOnce('exists' as never)
    expect(await commitDocTitle('未命名.md', '週報', d)).toEqual({ path: '未命名.md', status: 'exists' })
  })
})

describe('DocTitleField', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useUiModeStore.setState({ mode: 'v3' })
    useTitleFocusStore.setState({ pendingPath: null })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  async function render(props: React.ComponentProps<typeof DocTitleField>) {
    const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: React.createElement(DocTitleField, props) }
    await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
    return host.querySelector<HTMLInputElement>('input[data-doc-title]')
  }

  function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function key(input: HTMLInputElement, name: string, init: KeyboardEventInit = {}) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }))
  }

  it('is not shown in classic or for non-Markdown files', async () => {
    useUiModeStore.setState({ mode: 'classic' })
    expect(await render({ path: '未命名.md', onFocusBody: vi.fn() })).toBeNull()
    useUiModeStore.setState({ mode: 'v3' })
    expect(await render({ path: 'data.txt', onFocusBody: vi.fn() })).toBeNull()
    expect((await render({ path: '未命名.md', onFocusBody: vi.fn() }))?.value).toBe('未命名')
  })

  it('takes focus with 未命名 selected for a new document', async () => {
    useTitleFocusStore.getState().request('未命名.md')
    const input = (await render({ path: '未命名.md', onFocusBody: vi.fn() }))!
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, '未命名'.length])
    expect(useTitleFocusStore.getState().pendingPath).toBeNull()
  })

  it('commits on Enter, then moves the caret to the body', async () => {
    const onFocusBody = vi.fn()
    const commit = vi.fn(async () => ({ path: '週報.md', status: 'renamed' as const }))
    const input = (await render({ path: '未命名.md', onFocusBody, commit }))!
    await act(async () => type(input, '週報'))
    await act(async () => key(input, 'Enter'))
    expect(commit).toHaveBeenCalledWith('未命名.md', '週報')
    expect(onFocusBody).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('週報')
  })

  it('moves to the body with ArrowDown and ignores Enter while composing', async () => {
    const onFocusBody = vi.fn()
    const commit = vi.fn(async (path: string) => ({ path, status: 'unchanged' as const }))
    const input = (await render({ path: '未命名.md', onFocusBody, commit }))!
    await act(async () => key(input, 'Enter', { isComposing: true }))
    expect(onFocusBody).not.toHaveBeenCalled()
    await act(async () => key(input, 'ArrowDown'))
    expect(onFocusBody).toHaveBeenCalledTimes(1)
  })

  it('commits on blur and restores 未命名 when the title was cleared', async () => {
    const commit = vi.fn(async (path: string) => ({ path, status: 'unchanged' as const }))
    const input = (await render({ path: '未命名.md', onFocusBody: vi.fn(), commit }))!
    input.focus()
    await act(async () => type(input, ''))
    await act(async () => input.blur())
    expect(commit).toHaveBeenCalledWith('未命名.md', '')
    expect(input.value).toBe('未命名')
  })

  it('uses the renamed path for a blur that follows Enter before the tab updates', async () => {
    const commit = vi.fn(async (path: string, input: string) => (
      input === '週報' && path === '未命名.md' ? { path: '週報.md', status: 'renamed' as const } : { path, status: 'unchanged' as const }
    ))
    const input = (await render({ path: '未命名.md', onFocusBody: () => input.blur(), commit }))!
    input.focus()
    await act(async () => type(input, '週報'))
    await act(async () => key(input, 'Enter'))
    expect(commit.mock.calls).toEqual([['未命名.md', '週報'], ['週報.md', '週報']])
  })
})

it('focuses the start of the body only when the editor is ready', () => {
  const focus = vi.fn(() => true)
  expect(focusEditorBodyStart(null)).toBe(false)
  expect(focusEditorBodyStart({ isDestroyed: true, commands: { focus } })).toBe(false)
  expect(focusEditorBodyStart({ commands: { focus } })).toBe(true)
  expect(focus).toHaveBeenCalledWith('start')
})
