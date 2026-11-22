// @vitest-environment jsdom
// Fork（almanac ALMNC-56.7，RPT-2026-009 P06）：日誌輪詢內容沒變不更新；工作台沒開或視窗隱藏時暫停。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalSnapshot } from './project'
import { JOURNAL_POLL_MS, sameJournal, shouldPollJournal, useJournalPolling } from './journal-refresh'

const snapshot = (before: string, extra: Partial<JournalSnapshot> = {}): JournalSnapshot =>
  ({ before, section: '## 隨手記', fileMissing: false, today: '2026-11-22', path: 'd.md', workspace: '/v', ...extra })

describe('sameJournal / shouldPollJournal', () => {
  it('compares every field of the snapshot', () => {
    expect(sameJournal(null, null)).toBe(true)
    expect(sameJournal(snapshot('a'), null)).toBe(false)
    expect(sameJournal(snapshot('a'), snapshot('a'))).toBe(true)
    expect(sameJournal(snapshot('a'), snapshot('b'))).toBe(false)
    expect(sameJournal(snapshot('a'), snapshot('a', { today: '2026-11-23' }))).toBe(false)
    expect(sameJournal(snapshot('a'), snapshot('a', { fileMissing: true }))).toBe(false)
    expect(sameJournal(snapshot('a'), snapshot('a', { workspace: '/other' }))).toBe(false)
  })

  it('polls only while active and visible', () => {
    expect(shouldPollJournal({ active: true, hidden: false })).toBe(true)
    expect(shouldPollJournal({ active: false, hidden: false })).toBe(false)
    expect(shouldPollJournal({ active: true, hidden: true })).toBe(false)
  })
})

describe('decide store setJournal', () => {
  it('does not notify subscribers when the content is unchanged', async () => {
    const useDecideStore = (await import('@/stores/decide')).default
    useDecideStore.setState({ journal: null })
    const listener = vi.fn()
    const off = useDecideStore.subscribe(listener)
    useDecideStore.getState().setJournal(snapshot('a'))
    useDecideStore.getState().setJournal(snapshot('a'))
    expect(listener).toHaveBeenCalledTimes(1)
    useDecideStore.getState().setJournal(snapshot('b'))
    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })
})

describe('useJournalPolling', () => {
  let container: HTMLDivElement
  let root: Root
  let hidden = false

  function Probe({ active, refresh }: { active: boolean, refresh: () => void }) {
    useJournalPolling(active, refresh)
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  const setHidden = (value: boolean) => {
    hidden = value
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  }

  it('reads every minute while the workbench is open', () => {
    const refresh = vi.fn()
    act(() => root.render(h(Probe, { active: true, refresh })))
    act(() => { vi.advanceTimersByTime(JOURNAL_POLL_MS * 3) })
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('does not poll while the workbench is closed', () => {
    const refresh = vi.fn()
    act(() => root.render(h(Probe, { active: false, refresh })))
    act(() => { vi.advanceTimersByTime(JOURNAL_POLL_MS * 5) })
    expect(refresh).not.toHaveBeenCalled()
    act(() => root.render(h(Probe, { active: true, refresh })))
    act(() => { vi.advanceTimersByTime(JOURNAL_POLL_MS) })
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => root.render(h(Probe, { active: false, refresh })))
    act(() => { vi.advanceTimersByTime(JOURNAL_POLL_MS * 5) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('pauses while the window is hidden and catches up once when it comes back', () => {
    const refresh = vi.fn()
    act(() => root.render(h(Probe, { active: true, refresh })))
    setHidden(true)
    act(() => { vi.advanceTimersByTime(JOURNAL_POLL_MS * 5) })
    expect(refresh).not.toHaveBeenCalled()
    setHidden(false)
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(JOURNAL_POLL_MS) })
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
