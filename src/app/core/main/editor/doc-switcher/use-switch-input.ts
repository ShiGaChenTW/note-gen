'use client'

// Fork（almanac ALMNC-97.5）：文件切換的鍵盤與觸控板手勢。
// - 按住 ⌃ 按 Tab：開始選卡（A、C 展開疊卡、B 標出目標），繼續按 Tab 往下、⌃⇧Tab 往回，過程中順序不變；
//   放開 ⌃ 才切換並收合；途中按 Esc 取消，留在原本那篇。順序是最近使用（第一下就是上一篇）。
// - 在切換器的標題區用觸控板左右滑：往左滑（deltaX > 0）跳到最久沒看的那篇，往右滑回上一篇。
//   只掛在標題區，內文、表格、程式碼區塊、畫布的左右捲動不受影響。
import { useCallback, useEffect, useRef, type WheelEvent } from 'react'
import { useDocSwitcherStore } from '@/stores/doc-switcher'
import type { TabInfo } from '../tab-bar'
import { SWITCH_MS } from './motion'

/** 依最近使用排序，目前這張在第一個。 */
export function mruOrder(tabs: readonly TabInfo[], recency: readonly string[], activeTabId: string): string[] {
  const rank = new Map(recency.map((id, index) => [id, index]))
  const ids = [...tabs]
    .sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    .map(tab => tab.id)
  return activeTabId && ids.includes(activeTabId) ? [activeTabId, ...ids.filter(id => id !== activeTabId)] : ids
}

/** 選卡時往前（+1）或往回（-1）走一步，循環。 */
export function stepCycle(index: number, length: number, direction: 1 | -1): number {
  return (index + direction + length) % length
}

const SWIPE_THRESHOLD = 60
const SWIPE_LOCK_MS = 450

export function useSwitchInput({ tabs, activeTabId, onSwitch }: {
  tabs: readonly TabInfo[]
  activeTabId: string
  onSwitch: (tabId: string) => void
}) {
  const latest = useRef({ tabs, activeTabId, onSwitch })
  latest.current = { tabs, activeTabId, onSwitch }

  useEffect(() => {
    const store = useDocSwitcherStore
    let cycle: { ids: string[], index: number } | null = null

    const finish = (commit: boolean) => {
      if (!cycle) return
      const target = cycle.ids[cycle.index]
      cycle = null
      store.setState({ cycleTargetId: null })
      if (commit && target && target !== latest.current.activeTabId) latest.current.onSwitch(target)
      if (store.getState().style !== 'folder') {
        window.setTimeout(() => store.getState().setExpanded(false), commit ? SWITCH_MS : 0)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && event.ctrlKey && !event.metaKey && !event.altKey) {
        const { tabs: currentTabs, activeTabId: currentActive } = latest.current
        if (!cycle) {
          const ids = mruOrder(currentTabs, store.getState().recency, currentActive)
          if (ids.length < 2) return
          cycle = { ids, index: 0 }
          if (store.getState().style !== 'folder') store.getState().setExpanded(true)
        }
        event.preventDefault()
        event.stopPropagation()
        cycle.index = stepCycle(cycle.index, cycle.ids.length, event.shiftKey ? -1 : 1)
        store.setState({ cycleTargetId: cycle.ids[cycle.index] })
        return
      }
      if (event.key === 'Escape' && cycle) {
        event.preventDefault()
        event.stopPropagation()
        finish(false)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control' && cycle) finish(true)
    }
    const onBlur = () => finish(false)

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      if (cycle) store.setState({ cycleTargetId: null })
    }
  }, [])

  const swipe = useRef({ accumulated: 0, lockedUntil: 0 })
  const onWheel = useCallback((event: WheelEvent) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    const now = Date.now()
    if (now < swipe.current.lockedUntil) return
    swipe.current.accumulated += event.deltaX
    if (Math.abs(swipe.current.accumulated) < SWIPE_THRESHOLD) return
    const toOldest = swipe.current.accumulated > 0
    swipe.current = { accumulated: 0, lockedUntil: now + SWIPE_LOCK_MS }
    const { tabs: currentTabs, activeTabId: currentActive, onSwitch: switchTo } = latest.current
    const ids = mruOrder(currentTabs, useDocSwitcherStore.getState().recency, currentActive)
    if (ids.length < 2) return
    switchTo(toOldest ? ids[ids.length - 1] : ids[1])
  }, [])

  return { onWheel }
}
