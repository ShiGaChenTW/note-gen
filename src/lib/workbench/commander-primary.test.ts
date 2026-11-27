// Fork（almanac ALMNC-85.2，第 8 節 1A）：指揮官自動分析新資料源只在主力裝置跑；Scott 手動交給指揮官的每台都照跑。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  primary: true,
  kick: vi.fn(async () => ({ analyzed: [], rejected: [], failed: [] })),
}))

vi.mock('@/lib/almanac-sync/runtime', () => ({ isThisDeviceAlmanacPrimary: vi.fn(async () => fake.primary) }))
vi.mock('@/lib/commander/default-deps', () => ({ commanderQueue: async () => ({ kick: fake.kick }) }))
vi.mock('@/db/v3-sources', () => ({
  listSources: async () => [],
  countOutputsBySource: async () => new Map(),
  listLegacyNoteSources: async () => [],
}))
vi.mock('@/db/v3-legacy-packs', () => ({ listOpenLegacyPacks: async () => [] }))
vi.mock('@/db/v3-review-packs', () => ({ listOpenReviewPacks: async () => [] }))
vi.mock('@/db/v3-source-judgements', () => ({ listSourceJudgements: async () => new Map() }))
vi.mock('@/lib/migration/runtime', () => ({ legacyRunning: () => ({ running: false }) }))

const { kickCommander, sendToCommander } = await import('./actions')

beforeEach(() => {
  fake.kick.mockClear()
  fake.primary = true
})

describe('kickCommander：自動分析只在主力裝置', () => {
  it('主力裝置：新資料源自動交給指揮官', async () => {
    await kickCommander()
    expect(fake.kick).toHaveBeenCalledTimes(1)
  })

  it('不是主力裝置：自動分析不跑（資料源同步到主力裝置後由它分析）', async () => {
    fake.primary = false
    await kickCommander()
    expect(fake.kick).not.toHaveBeenCalled()
  })

  it('不是主力裝置：Scott 手動「送給指揮官」照跑', async () => {
    fake.primary = false
    await kickCommander({ manual: true })
    await sendToCommander('src_1')
    expect(fake.kick).toHaveBeenCalledTimes(2)
  })
})
