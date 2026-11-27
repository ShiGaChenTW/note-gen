// Fork（almanac ALMNC-85.4，第 8 節 1A）：每週整理（含研究員）的排程只在主力裝置跑。
// 上次執行時間改成各台分開（almanacReviewLastRun 不同步），不擋的話兩台會各跑一輪、出兩張整理卡；「現在執行一次」每台都能按。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  primary: true as boolean | Error,
  maybeRunReview: vi.fn(async () => ({ ran: false, research: [], expertReviews: [], audit: [], errors: [] })),
  runReview: vi.fn(async () => ({ ran: true, research: [], expertReviews: [], audit: [], errors: [] })),
}))

vi.mock('@/lib/almanac-sync/runtime', () => ({
  isThisDeviceAlmanacPrimary: vi.fn(async () => {
    if (fake.primary instanceof Error) throw fake.primary
    return fake.primary
  }),
}))
vi.mock('./runner', () => ({ maybeRunReview: fake.maybeRunReview, runReview: fake.runReview }))

const { isReviewDevice, runReviewNow, runScheduledReview } = await import('./runtime')
const deps = async () => ({}) as never

beforeEach(() => {
  fake.primary = true
  fake.maybeRunReview.mockClear()
  fake.runReview.mockClear()
})

describe('每週整理排程只在主力裝置（85.4，1A）', () => {
  it('主力裝置：排程照跑', async () => {
    expect(await isReviewDevice()).toBe(true)
    await runScheduledReview(deps)
    expect(fake.maybeRunReview).toHaveBeenCalledTimes(1)
  })

  it('不是主力裝置：排程不跑', async () => {
    fake.primary = false
    expect(await isReviewDevice()).toBe(false)
    await runScheduledReview(deps)
    expect(fake.maybeRunReview).not.toHaveBeenCalled()
  })

  it('讀不到主力裝置（V3 同步模組壞了）：當成只有這一台，照跑', async () => {
    fake.primary = new Error('store unavailable')
    expect(await isReviewDevice()).toBe(true)
  })

  it('不是主力裝置：Scott 按「現在執行一次」照跑', async () => {
    fake.primary = false
    await runReviewNow(deps)
    expect(fake.runReview).toHaveBeenCalledTimes(1)
  })
})
