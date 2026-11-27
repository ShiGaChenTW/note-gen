// @vitest-environment jsdom
// almanac ALMNC-97.3：樣式 B 資料夾標籤——顯示順序、放不下時收進「更多」、目前這張一定看得到、點標籤切換。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../../messages/zh-TW.json'
import type { TabInfo } from '../tab-bar'
import { FolderTabsSwitcher } from './folder-tabs'

const tab = (id: string, extra: Partial<TabInfo> = {}): TabInfo => ({ id, path: `${id}.md`, name: `${id}.md`, isFolder: false, kind: 'file', ...extra })

let host: HTMLDivElement
let root: Root
let rowWidth = 0

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.hasAttribute('data-doc-switcher-row') ? rowWidth : 0 } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render(tabs: TabInfo[], activeTabId: string, onSwitch = vi.fn()) {
  await act(async () => root.render(
    <NextIntlClientProvider locale="zh-TW" messages={zhTW} timeZone="Asia/Taipei">
      <FolderTabsSwitcher tabs={tabs} activeTabId={activeTabId} onSwitch={onSwitch} onClose={vi.fn()} onPin={vi.fn()} onUnpin={vi.fn()} cycleTargetId={null} onWheel={vi.fn()}>
        <div>content</div>
      </FolderTabsSwitcher>
    </NextIntlClientProvider>,
  ))
  return onSwitch
}

const tabNames = () => [...host.querySelectorAll('[role="tab"]')].map(el => el.textContent)

it('寬度夠時依傳入順序全部顯示，沒有「更多」', async () => {
  rowWidth = 2000
  await render([tab('p', { pinned: true }), tab('a'), tab('b')], 'a')
  expect(tabNames()).toEqual(['p', 'a', 'b'])
  expect(host.textContent).not.toContain('更多')
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('a')
})

it('放不下時最久沒看的收進「更多」', async () => {
  rowWidth = 400 // 放得下 2 張
  await render([tab('a'), tab('b'), tab('c'), tab('d')], 'a')
  expect(tabNames()).toEqual(['a', 'b'])
  expect(host.textContent).toContain('更多 2')
})

it('點標籤切換到那一篇；點目前這張不會重複切換', async () => {
  rowWidth = 2000
  const onSwitch = await render([tab('a'), tab('b')], 'a')
  const [first, second] = host.querySelectorAll<HTMLElement>('[role="tab"]')
  await act(async () => first.click())
  expect(onSwitch).not.toHaveBeenCalled()
  await act(async () => second.click())
  expect(onSwitch).toHaveBeenCalledWith('b')
})

it('標籤的無障礙名稱含位置；固定的分頁沒有關閉鈕', async () => {
  rowWidth = 2000
  await render([tab('p', { pinned: true }), tab('a')], 'p')
  const first = host.querySelector('[role="tab"]')!
  expect(first.getAttribute('aria-label')).toBe('p，第 1 張，共 2 張')
  expect(first.querySelector('button')).toBeNull()
})
