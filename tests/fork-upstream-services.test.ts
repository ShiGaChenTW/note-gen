// Fork (#16)：上游的設定中心與儲存後自動向量，預設都不對外連線。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeValues = new Map<string, unknown>()
const httpFetch = vi.fn()
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async (key: string) => storeValues.get(key), set: async () => {}, save: async () => {} }) },
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

const { fetchConfigCenterConfig } = await import('@/lib/config-center/client')

beforeEach(() => {
  storeValues.clear()
  httpFetch.mockReset()
})

describe('設定中心預設不連線', () => {
  it('沒有開啟旗標時回傳 not-modified，完全不發請求', async () => {
    await expect(fetchConfigCenterConfig('noteGenModelPolicy')).resolves.toEqual({ status: 'not-modified' })
    await expect(fetchConfigCenterConfig('providerTemplates', 3)).resolves.toEqual({ status: 'not-modified' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('旗標不是 true 時（false、字串）一樣不連線', async () => {
    storeValues.set('upstreamConfigCenterEnabled', 'true')
    await fetchConfigCenterConfig('noteGenDefaultModels')
    storeValues.set('upstreamConfigCenterEnabled', false)
    await fetchConfigCenterConfig('noteGenDefaultModels')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('upstreamConfigCenterEnabled 為 true 才會抓清單', async () => {
    storeValues.set('upstreamConfigCenterEnabled', true)
    httpFetch.mockRejectedValue(new Error('offline'))
    await expect(fetchConfigCenterConfig('noteGenModelPolicy')).rejects.toThrow()
    expect(httpFetch).toHaveBeenCalledTimes(1)
    expect(String(httpFetch.mock.calls[0][0])).toContain('config-manifest.json')
  })
})
