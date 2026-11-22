// @vitest-environment jsdom
// Fork（almanac ALMNC-54.11）：「問 Scott」的小選單——四個去處（模型猜的標「建議」）、選專家、偏好確認、Esc 取消。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import type { RouteDecision } from '@/lib/router/router'
import useRouterStore, { type RouterAnswer } from '@/stores/router'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

vi.mock('@/lib/workbench/use-workbench', () => ({
  useRoster: () => [
    { id: 'cmd', name: 'Mia', role: 'commander', enabled: true },
    { id: 'sec', name: 'Leo', role: 'secretary', enabled: true },
  ],
}))

const { RouteChooser } = await import('./route-chooser')

const decision: RouteDecision = { route: null, target: null, confidence: 0.55, layer: 'ask', reason: 'low_confidence', suggestion: 'query', text: '上次會議決定了什麼' }

let container: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages, timeZone: 'Asia/Taipei', children: h(RouteChooser) }))
  })
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-route]'))
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useRouterStore.setState({ prompt: null })
})

describe('RouteChooser', () => {
  it('renders nothing without a question', () => {
    render()
    expect(container.innerHTML).toBe('')
  })

  it('AC#3: offers the four destinations with names, marks the suggestion, and routes the choice', () => {
    const answers: RouterAnswer[] = []
    act(() => useRouterStore.getState().ask({ kind: 'askRoute', decision }, answer => answers.push(answer)))
    render()
    expect(container.textContent).toContain('這句要交給誰？')
    expect(buttons().map(button => button.dataset.route)).toEqual(['schedule', 'process', 'query', 'preference'])
    expect(buttons()[0].textContent).toBe('Leo（日程）')
    expect(buttons()[1].textContent).toBe('Mia（處理）')
    expect(buttons()[2].textContent).toContain('建議')
    act(() => buttons()[0].click())
    expect(answers).toEqual([{ kind: 'route', route: 'schedule' }])
    expect(useRouterStore.getState().prompt).toBeNull()
  })

  it('says when the local model is not running', () => {
    act(() => useRouterStore.getState().ask({ kind: 'askRoute', decision: { ...decision, reason: 'model_unavailable', suggestion: undefined } }, () => undefined))
    render()
    expect(container.textContent).toContain('本機模型沒有開')
  })

  it('asks which expert, and confirms a preference in one line', () => {
    const answers: RouterAnswer[] = []
    act(() => useRouterStore.getState().ask({ kind: 'askExpert', decision, candidates: [{ id: 'ie', name: 'Alex', role: 'expert', domain: '工業工程', enabled: true }] }, answer => answers.push(answer)))
    render()
    act(() => buttons()[0].click())
    expect(answers.at(-1)).toEqual({ kind: 'expert', agentId: 'ie' })

    act(() => useRouterStore.getState().ask({ kind: 'confirmPreference', decision, line: '卡片文字不要用粗體字' }, answer => answers.push(answer)))
    expect(container.textContent).toContain('存成你的偏好：「卡片文字不要用粗體字」？')
    act(() => buttons()[0].click())
    expect(answers.at(-1)).toEqual({ kind: 'savePreference' })
  })

  it('Esc cancels and keeps nothing open', () => {
    const answers: RouterAnswer[] = []
    act(() => useRouterStore.getState().ask({ kind: 'askRoute', decision }, answer => answers.push(answer)))
    render()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(answers).toEqual([{ kind: 'cancel' }])
    expect(container.innerHTML).toBe('')
  })
})
