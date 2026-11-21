// Fork（almanac ALMNC-54.10）：本機模型客戶端——請求格式、逾時與無法使用時的降級、可用性快取、設定讀回。
import { describe, expect, it, vi } from 'vitest'
import { createLocalModelClient, DEFAULT_LOCAL_MODEL_CONFIG, LocalModelUnavailableError, sanitizeLocalModelConfig, type FetchLike } from './client'

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

describe('createLocalModelClient', () => {
  it('posts embeddings and generation to ollama with think:false', async () => {
    const calls: Array<{ url: string, body: unknown }> = []
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined })
      if (url.endsWith('/api/embed')) return okJson({ embeddings: [[1, 0], [0, 1]] })
      return okJson({ response: '  會議紀錄｜拆出任務\n' })
    }
    const client = createLocalModelClient({ ...DEFAULT_LOCAL_MODEL_CONFIG, endpoint: 'http://localhost:11434/' }, { fetch })
    expect(await client.embed(['a', 'b'])).toEqual([[1, 0], [0, 1]])
    expect(await client.generate('判斷', { maxTokens: 40 })).toBe('會議紀錄｜拆出任務')
    expect(calls[0]).toEqual({ url: 'http://localhost:11434/api/embed', body: { model: 'qwen3-embedding:0.6b', input: ['a', 'b'] } })
    expect(calls[1].url).toBe('http://localhost:11434/api/generate')
    expect(calls[1].body).toMatchObject({ model: 'qwen3.5:2b', stream: false, think: false, options: { temperature: 0, num_predict: 40 } })
  })

  it('throws LocalModelUnavailableError when ollama is not running, and caches that for the availability check', async () => {
    let now = 0
    const fetch = vi.fn<FetchLike>(async () => { throw new TypeError('connection refused') })
    const client = createLocalModelClient(DEFAULT_LOCAL_MODEL_CONFIG, { fetch, now: () => now, availabilityTtlMs: 30_000 })
    await expect(client.embed(['x'])).rejects.toBeInstanceOf(LocalModelUnavailableError)
    expect(await client.available()).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1) // 剛失敗過：快取，不再等一次
    now = 31_000
    expect(await client.available()).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('times out instead of hanging', async () => {
    vi.useFakeTimers()
    try {
      const fetch: FetchLike = () => new Promise(() => undefined)
      const client = createLocalModelClient({ ...DEFAULT_LOCAL_MODEL_CONFIG, timeoutMs: 1000 }, { fetch })
      const pending = expect(client.generate('x')).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(1001)
      await pending
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats HTTP errors and malformed answers as unavailable', async () => {
    const http = createLocalModelClient(DEFAULT_LOCAL_MODEL_CONFIG, { fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) })
    await expect(http.generate('x')).rejects.toThrow(/404/)
    const empty = createLocalModelClient(DEFAULT_LOCAL_MODEL_CONFIG, { fetch: async () => okJson({ embeddings: [] }) })
    await expect(empty.embed(['x'])).rejects.toBeInstanceOf(LocalModelUnavailableError)
  })

  it('never sends a request when disabled', async () => {
    const fetch = vi.fn<FetchLike>()
    const client = createLocalModelClient({ ...DEFAULT_LOCAL_MODEL_CONFIG, enabled: false }, { fetch })
    expect(await client.available()).toBe(false)
    await expect(client.embed(['x'])).rejects.toBeInstanceOf(LocalModelUnavailableError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports available when /api/version answers', async () => {
    const client = createLocalModelClient(DEFAULT_LOCAL_MODEL_CONFIG, { fetch: async () => okJson({ version: '0.40.16' }) })
    expect(await client.available()).toBe(true)
  })
})

describe('sanitizeLocalModelConfig', () => {
  it('keeps configured endpoint and model names, falls back to defaults', () => {
    expect(sanitizeLocalModelConfig(undefined)).toEqual(DEFAULT_LOCAL_MODEL_CONFIG)
    expect(sanitizeLocalModelConfig({ endpoint: 'http://mac-mini:11434', judgeModel: 'qwen3.5:4b', timeoutMs: 10, enabled: false, extra: 1 })).toEqual({
      ...DEFAULT_LOCAL_MODEL_CONFIG, endpoint: 'http://mac-mini:11434', judgeModel: 'qwen3.5:4b', enabled: false,
    })
  })
})
