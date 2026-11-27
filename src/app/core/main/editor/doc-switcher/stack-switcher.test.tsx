// @vitest-environment jsdom
// almanac ALMNC-97.4：樣式 A、C——平常收合、按疊卡鈕展開、點後面的卡切換並自動收合、Esc 收合、超過 4 張收進「更多」。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../../messages/zh-TW.json'
import { useDocSwitcherStore } from '@/stores/doc-switcher'
import type { TabInfo } from '../tab-bar'
import { StackSwitcher } from './stack-switcher'

const tab = (id: string): TabInfo => ({ id, path: `${id}.md`, name: `${id}.md`, isFolder: false, kind: 'file' })

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useDocSwitcherStore.setState({ expanded: false, recency: ['a', 'b', 'c', 'd', 'e', 'f'] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function render(tabs: TabInfo[], activeTabId: string, variant: 'stack' | 'fan' = 'stack', onSwitch = vi.fn()) {
  await act(async () => root.render(
    <NextIntlClientProvider locale="zh-TW" messages={zhTW} timeZone="Asia/Taipei">
      <StackSwitcher variant={variant} tabs={tabs} activeTabId={activeTabId} onSwitch={onSwitch} onClose={vi.fn()} onPin={vi.fn()} onUnpin={vi.fn()}>
        <div>content</div>
      </StackSwitcher>
    </NextIntlClientProvider>,
  ))
  return onSwitch
}

const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
const backCards = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-depth]')]

it('平常收合：後面的卡藏起來、不能用鍵盤選到；疊卡鈕顯示總張數', async () => {
  await render([tab('a'), tab('b'), tab('c')], 'a')
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  expect(toggle().textContent).toBe('3')
  expect(backCards().every(card => card.tabIndex === -1 && card.getAttribute('aria-hidden') === 'true')).toBe(true)
})

it('按疊卡鈕展開；點後面的卡切換，動畫結束後自動收合', async () => {
  const onSwitch = await render([tab('a'), tab('b'), tab('c')], 'a')
  await act(async () => toggle().click())
  expect(useDocSwitcherStore.getState().expanded).toBe(true)
  const cards = backCards()
  expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(['b', 'c'])
  expect(cards[0].style.transform).toBe('translateY(-24px) scaleX(0.98)')
  await act(async () => cards[1].click())
  expect(onSwitch).toHaveBeenCalledWith('c')
  await act(async () => { vi.advanceTimersByTime(400) })
  expect(useDocSwitcherStore.getState().expanded).toBe(false)
})

it('C 斜向錯開往左上', async () => {
  await render([tab('a'), tab('b')], 'a', 'fan')
  await act(async () => toggle().click())
  expect(backCards()[0].style.transform).toBe('translate(-28px, -24px)')
})

it('Esc 收合', async () => {
  await render([tab('a'), tab('b')], 'a')
  await act(async () => toggle().click())
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  expect(useDocSwitcherStore.getState().expanded).toBe(false)
})

it('展開時最多 4 張後面的卡，其餘收進「更多」', async () => {
  await render(['a', 'b', 'c', 'd', 'e', 'f'].map(tab), 'a')
  await act(async () => toggle().click())
  expect(backCards()).toHaveLength(4)
  expect(host.textContent).toContain('更多 1')
})
