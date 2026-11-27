// @vitest-environment jsdom
// almanac ALMNC-97.5：按住 ⌃ 選卡——順序依最近使用、過程中不切換、放開 ⌃ 才切換、Esc 取消；觸控板左右滑。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDocSwitcherStore } from '@/stores/doc-switcher'
import type { TabInfo } from '../tab-bar'
import { mruOrder, stepCycle, useSwitchInput } from './use-switch-input'

const tab = (id: string): TabInfo => ({ id, path: `${id}.md`, name: id, isFolder: false, kind: 'file' })
const TABS = ['a', 'b', 'c', 'd'].map(tab)

let host: HTMLDivElement
let root: Root
let onWheel: ReturnType<typeof useSwitchInput>['onWheel']

function Harness({ onSwitch }: { onSwitch: (id: string) => void }) {
  onWheel = useSwitchInput({ tabs: TABS, activeTabId: 'a', onSwitch }).onWheel
  return null
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useDocSwitcherStore.setState({ recency: ['a', 'c', 'b', 'd'], style: 'stack', expanded: false, cycleTargetId: null })
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

async function mount() {
  const onSwitch = vi.fn()
  await act(async () => root.render(<Harness onSwitch={onSwitch} />))
  return onSwitch
}
const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) => act(async () => { window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })) })

it('mruOrder：目前這張在第一個，其餘依最近使用', () => {
  expect(mruOrder(TABS, ['c', 'a', 'd'], 'a')).toEqual(['a', 'c', 'd', 'b'])
})

it('stepCycle 循環', () => {
  expect(stepCycle(3, 4, 1)).toBe(0)
  expect(stepCycle(0, 4, -1)).toBe(3)
})

it('按住 ⌃ 連按 Tab 往下選、不切換；放開 ⌃ 才切換並收合', async () => {
  const onSwitch = await mount()
  await key('keydown', { key: 'Tab', ctrlKey: true })
  expect(useDocSwitcherStore.getState().cycleTargetId).toBe('c')
  expect(useDocSwitcherStore.getState().expanded).toBe(true)
  await key('keydown', { key: 'Tab', ctrlKey: true })
  expect(useDocSwitcherStore.getState().cycleTargetId).toBe('b')
  await key('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true })
  expect(useDocSwitcherStore.getState().cycleTargetId).toBe('c')
  expect(onSwitch).not.toHaveBeenCalled()
  await key('keyup', { key: 'Control' })
  expect(onSwitch).toHaveBeenCalledWith('c')
  expect(useDocSwitcherStore.getState().cycleTargetId).toBeNull()
  await act(async () => { vi.advanceTimersByTime(400) })
  expect(useDocSwitcherStore.getState().expanded).toBe(false)
})

it('選卡途中按 Esc 取消，不切換', async () => {
  const onSwitch = await mount()
  await key('keydown', { key: 'Tab', ctrlKey: true })
  await key('keydown', { key: 'Escape', ctrlKey: true })
  await key('keyup', { key: 'Control' })
  expect(onSwitch).not.toHaveBeenCalled()
  expect(useDocSwitcherStore.getState().cycleTargetId).toBeNull()
})

it('觸控板往右滑回上一篇、往左滑跳到最久沒看的那篇；垂直捲動不切換', async () => {
  const onSwitch = await mount()
  const wheel = (deltaX: number, deltaY = 0) => onWheel({ deltaX, deltaY } as never)
  wheel(0, 200)
  expect(onSwitch).not.toHaveBeenCalled()
  wheel(-80)
  expect(onSwitch).toHaveBeenLastCalledWith('c')
  vi.advanceTimersByTime(500)
  wheel(80)
  expect(onSwitch).toHaveBeenLastCalledWith('d')
})
