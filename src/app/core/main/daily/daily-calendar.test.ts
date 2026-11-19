// @vitest-environment jsdom
import React, { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import useDailySettingsStore from '@/stores/daily-settings'
import zhTW from '../../../../../messages/zh-TW.json'
import { DailyNavStatusItem } from './daily-calendar'
import { openTodayTab } from '../today/today-tab'
import { TodayStatusItem } from '../today/today-status-item'

vi.mock('../today/today-tab', () => ({ openTodayTab: vi.fn() }))

it('shows only today’s date in v3 and reuses the Today action', () => {
  vi.setSystemTime(new Date(2026, 10, 19, 12))
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    useUiModeStore.setState({ mode: 'v3' })
    useDailySettingsStore.setState({ initialized: true })
    const intl = {
      locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei',
      children: createElement(React.Fragment, null, createElement(DailyNavStatusItem), createElement(TodayStatusItem)),
    }
    act(() => root.render(createElement(NextIntlClientProvider, intl)))
    expect(host.textContent).toBe('11月19日 週四')
    expect(host.querySelectorAll('button')).toHaveLength(1)
    expect(host.querySelector('svg,[aria-haspopup]')).toBeNull()
    act(() => host.querySelector('button')?.click())
    expect(openTodayTab).toHaveBeenCalledOnce()
    vi.setSystemTime(new Date(2026, 10, 20))
    act(() => window.dispatchEvent(new Event('focus')))
    expect(host.textContent).toBe('11月20日 週五')
    act(() => useUiModeStore.setState({ mode: 'classic' }))
    expect(host.querySelector('[aria-haspopup="dialog"]')).not.toBeNull()
    expect(host.textContent).toBe(zhTW.today.status.open)
  } finally {
    act(() => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
