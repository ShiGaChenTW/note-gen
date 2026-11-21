// almanac ALMNC-45：電子紙設定、釘選資料與私人標記存在 store.json，重開 app（重新讀檔）還在；token 不進設定同步。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureEinkStorage, type EinkStorage } from '@/lib/eink/storage'
import { EINK_SETTINGS_KEY, EINK_TOKEN_KEY } from '@/lib/eink/settings'
import { EINK_PINS_KEY } from '@/lib/eink/pins'
import { EINK_PRIVATE_KEY } from '@/lib/eink/privacy'
import { shouldExcludeFromSync } from '@/config/sync-exclusions'
import useEinkStore, { resetEinkStoreForTest } from './eink'

function memoryStorage(initial: Record<string, unknown> = {}): EinkStorage & { data: Map<string, unknown>, saves: number } {
  const data = new Map(Object.entries(initial))
  return {
    data, saves: 0,
    get: async key => structuredClone(data.get(key)),
    set: async (key, value) => { data.set(key, structuredClone(value)) },
    async save() { this.saves += 1 },
  }
}

/** 模擬重開 app：store 回到還沒讀檔，再從同一份 store.json 讀回。 */
async function reopen() {
  resetEinkStoreForTest()
  await useEinkStore.getState().init()
  return useEinkStore.getState()
}

let storage: ReturnType<typeof memoryStorage>
beforeEach(() => {
  storage = memoryStorage()
  configureEinkStorage(storage)
  resetEinkStoreForTest()
})
afterEach(() => configureEinkStorage(null))

describe('useEinkStore 保存', () => {
  it('設定值重開後還在', async () => {
    await useEinkStore.getState().updateSettings({
      enabled: true, readerAddress: 'http://192.168.1.20', lanServer: true, sections: ['schedule', 'pinned'], weatherCity: '臺北',
    })
    const state = await reopen()
    expect(state.settings).toEqual({
      enabled: true, readerAddress: 'http://192.168.1.20', lanServer: true, sections: ['schedule', 'pinned'], weatherCity: '臺北',
    })
    expect(storage.data.get(EINK_SETTINGS_KEY)).toEqual(state.settings)
  })

  it('第一次讀檔產生 token 並存下；重開後是同一個；重新產生後換掉', async () => {
    await useEinkStore.getState().init()
    const first = useEinkStore.getState().token
    expect(first).toMatch(/^[0-9a-f]{48}$/)
    expect(storage.data.get(EINK_TOKEN_KEY)).toBe(first)
    expect((await reopen()).token).toBe(first)
    await useEinkStore.getState().regenerateToken()
    const second = useEinkStore.getState().token
    expect(second).not.toBe(first)
    expect((await reopen()).token).toBe(second)
  })

  it('釘選、排序、移除後重開，清單一樣', async () => {
    const store = useEinkStore.getState()
    await store.togglePin('a.md')
    await store.togglePin('b.md')
    await store.togglePin('c.md')
    await store.movePin('c.md', -1)
    await store.removePin('a.md')
    const state = await reopen()
    expect(state.pins.map(pin => [pin.path, pin.order])).toEqual([['c.md', 0], ['b.md', 1]])
    expect(state.pins.every(pin => typeof pin.pinnedAt === 'number')).toBe(true)
    expect(storage.data.get(EINK_PINS_KEY)).toEqual(state.pins)
  })

  it('改名、移動與刪除後的清單也存檔', async () => {
    const store = useEinkStore.getState()
    await store.togglePin('夾/a.md')
    await store.togglePin('b.md')
    await store.handlePathMove('夾', '新夾')
    await store.handlePathDelete('b.md', false)
    expect((await reopen()).pins.map(pin => pin.path)).toEqual(['新夾/a.md'])
  })

  it('行程的私人標記重開後還在', async () => {
    await useEinkStore.getState().setPrivate('cal:E1', true)
    await useEinkStore.getState().setPrivate('task:a.md#寫報告', true)
    await useEinkStore.getState().setPrivate('task:a.md#寫報告', false)
    expect((await reopen()).privateItems).toEqual(['cal:E1'])
    expect(storage.data.get(EINK_PRIVATE_KEY)).toEqual(['cal:E1'])
  })

  it('讀檔失敗時不產生 token、不寫回（免得蓋掉讀不到的內容）', async () => {
    const broken: EinkStorage = { get: async () => { throw new Error('locked') }, set: vi.fn(), save: vi.fn() }
    configureEinkStorage(broken)
    await useEinkStore.getState().init()
    expect(useEinkStore.getState().loaded).toBe(true)
    expect(broken.set).not.toHaveBeenCalled()
  })

  it('還沒讀檔就操作時，先讀檔再改（不會用空清單蓋掉已存的）', async () => {
    storage.data.set(EINK_PINS_KEY, [{ path: 'old.md', pinnedAt: 1, order: 0 }])
    await useEinkStore.getState().togglePin('new.md')
    expect(useEinkStore.getState().pins.map(pin => pin.path)).toEqual(['old.md', 'new.md'])
  })
})

describe('設定同步排除', () => {
  it('電子紙的設定、token 與清單都不跟著設定同步（即使關掉「排除敏感設定」）', () => {
    for (const key of [EINK_SETTINGS_KEY, EINK_TOKEN_KEY, EINK_PINS_KEY, EINK_PRIVATE_KEY]) {
      expect(shouldExcludeFromSync(key, { excludeSensitiveConfig: false })).toBe(true)
    }
  })
})
