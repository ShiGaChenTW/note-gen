// Fork（almanac ALMNC-85.2，第 8 節 1A）：開了 V3 同步時，RSS 自動排程只在主力裝置跑；主力裝置改了就重新判斷。
import { act } from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  primary: true,
  started: false,
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@/lib/fork-ui', () => ({ useUiV3: () => true }))
vi.mock('@/lib/almanac-sync/runtime', () => ({ isThisDeviceAlmanacPrimary: vi.fn(async () => fake.primary) }))
vi.mock('@/lib/source-import/rss-store', () => {
  const scheduler = {
    get started() { return fake.started },
    start: async () => { fake.started = true; fake.start(); return [] },
    stop: () => { fake.started = false; fake.stop() },
  }
  return {
    default: { getState: () => ({ load: async () => undefined }) },
    rssScheduler: () => scheduler,
  }
})

const { RssService } = await import('./rss-service')
const { default: emitter } = await import('@/lib/emitter')

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

beforeEach(() => {
  fake.primary = true
  fake.started = false
  fake.start.mockClear()
  fake.stop.mockClear()
})

describe('RssService：自動排程只在主力裝置', () => {
  it('主力裝置：啟動排程', async () => {
    render(<RssService />)
    await settle()
    expect(fake.start).toHaveBeenCalledTimes(1)
  })

  it('不是主力裝置：不啟動；改由這台跑背景工作後才啟動，主力裝置換走就停', async () => {
    fake.primary = false
    const view = render(<RssService />)
    await settle()
    expect(fake.start).not.toHaveBeenCalled()

    fake.primary = true
    emitter.emit('almanac-sync-state-changed', undefined)
    await settle()
    expect(fake.start).toHaveBeenCalledTimes(1)

    fake.primary = false
    emitter.emit('almanac-sync-state-changed', undefined)
    await settle()
    expect(fake.stop).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
