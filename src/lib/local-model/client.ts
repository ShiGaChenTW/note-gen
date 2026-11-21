// Fork（almanac ALMNC-54.10）：本機模型（ollama）的小客戶端——嵌入、生成（think:false）、逾時、可用性檢查（有快取）。
// 路由器（R4，src/lib/router/）用嵌入模型分流，初步判斷（R1，src/lib/workbench/judgement.ts）用小型生成模型判斷類型。
// 依 ALMNC-54.9 實測（almanac/2026-11-21_report_local-router-spike.md）：分流用 qwen3-embedding:0.6b，初步判斷用 qwen3.5:2b，
// 生成模型不拿來分流。ollama 沒開、模型沒下載、逾時，一律丟 LocalModelUnavailableError，呼叫端照「沒有本機模型」降級。
// fetch 由外部注入：App 內用 Tauri 的 http 外掛（避開 webview 的 CORS），測試用假的。

export interface LocalModelConfig {
  /** 關掉時一律當成無法使用（不發任何請求）。 */
  enabled: boolean
  /** ollama 位址，例如 http://localhost:11434。 */
  endpoint: string
  /** 指令分流（R4 第二層）用的嵌入模型。 */
  embeddingModel: string
  /** 初步判斷（R1）用的小型生成模型。 */
  judgeModel: string
  /** 單次請求逾時（毫秒）。 */
  timeoutMs: number
}

export const DEFAULT_LOCAL_MODEL_CONFIG: LocalModelConfig = {
  enabled: true,
  endpoint: 'http://localhost:11434',
  embeddingModel: 'qwen3-embedding:0.6b',
  judgeModel: 'qwen3.5:2b',
  timeoutMs: 15_000,
}

export class LocalModelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalModelUnavailableError'
  }
}

export type FetchLike = (url: string, init: { method: string, headers?: Record<string, string>, body?: string, signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

export interface GenerateOptions {
  /** 最多產生幾個 token；初步判斷只要一行。 */
  maxTokens?: number
  temperature?: number
}

export interface LocalModel {
  readonly config: LocalModelConfig
  /** ollama 有沒有在跑（結果快取一段時間；失敗也快取，免得每句話都等逾時）。 */
  available: () => Promise<boolean>
  embed: (texts: readonly string[]) => Promise<number[][]>
  generate: (prompt: string, options?: GenerateOptions) => Promise<string>
}

export interface LocalModelClientOptions {
  fetch: FetchLike
  now?: () => number
  /** 可用性快取多久（毫秒）。 */
  availabilityTtlMs?: number
}

const AVAILABILITY_TTL_MS = 30_000
const PROBE_TIMEOUT_MS = 1_500

function trimEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

export function createLocalModelClient(config: LocalModelConfig, options: LocalModelClientOptions): LocalModel {
  const now = options.now ?? (() => Date.now())
  const ttl = options.availabilityTtlMs ?? AVAILABILITY_TTL_MS
  const base = trimEndpoint(config.endpoint)
  let cached: { ok: boolean, at: number } | undefined

  function remember(ok: boolean) {
    cached = { ok, at: now() }
  }

  async function request(path: string, init: { method: string, body?: unknown }, timeoutMs: number): Promise<unknown> {
    if (!config.enabled) throw new LocalModelUnavailableError('local model disabled')
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort()
        reject(new LocalModelUnavailableError(`local model timed out after ${timeoutMs} ms`))
      }, timeoutMs)
    })
    try {
      const response = await Promise.race([
        options.fetch(`${base}${path}`, {
          method: init.method,
          headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller?.signal,
        }),
        timeout,
      ])
      if (!response.ok) throw new LocalModelUnavailableError(`local model HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      if (error instanceof LocalModelUnavailableError) throw error
      throw new LocalModelUnavailableError(error instanceof Error ? error.message : String(error))
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** 請求失敗就把快取標成無法使用，下一句話不用再等逾時。 */
  async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      const result = await run()
      remember(true)
      return result
    } catch (error) {
      remember(false)
      throw error
    }
  }

  return {
    config,
    available: async () => {
      if (!config.enabled) return false
      if (cached && now() - cached.at < ttl) return cached.ok
      try {
        await request('/api/version', { method: 'GET' }, Math.min(PROBE_TIMEOUT_MS, config.timeoutMs))
        remember(true)
      } catch {
        remember(false)
      }
      return cached!.ok
    },
    embed: texts => guarded(async () => {
      if (!texts.length) return []
      const data = await request('/api/embed', { method: 'POST', body: { model: config.embeddingModel, input: [...texts] } }, config.timeoutMs) as { embeddings?: unknown }
      const embeddings = data.embeddings
      if (!Array.isArray(embeddings) || embeddings.length !== texts.length || !embeddings.every(row => Array.isArray(row) && row.length > 0)) {
        throw new LocalModelUnavailableError('local model returned no embeddings')
      }
      return embeddings as number[][]
    }),
    generate: (prompt, generateOptions = {}) => guarded(async () => {
      const data = await request('/api/generate', {
        method: 'POST',
        body: {
          model: config.judgeModel,
          prompt,
          stream: false,
          // 只要答案，不要思考過程（2B 在 ollama 預設會先想，慢又會把格式弄亂）。
          think: false,
          options: { temperature: generateOptions.temperature ?? 0, num_predict: generateOptions.maxTokens ?? 60 },
        },
      }, config.timeoutMs) as { response?: unknown }
      if (typeof data.response !== 'string') throw new LocalModelUnavailableError('local model returned no text')
      return data.response.trim()
    }),
  }
}

/** 讀回 store.json 的 localModel 設定：不認得的欄位丟掉，缺的用預設值。 */
export function sanitizeLocalModelConfig(value: unknown): LocalModelConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const text = (key: keyof LocalModelConfig) => typeof raw[key] === 'string' && (raw[key] as string).trim() ? (raw[key] as string).trim() : undefined
  const timeout = typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs >= 500 ? raw.timeoutMs : undefined
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_LOCAL_MODEL_CONFIG.enabled,
    endpoint: text('endpoint') ?? DEFAULT_LOCAL_MODEL_CONFIG.endpoint,
    embeddingModel: text('embeddingModel') ?? DEFAULT_LOCAL_MODEL_CONFIG.embeddingModel,
    judgeModel: text('judgeModel') ?? DEFAULT_LOCAL_MODEL_CONFIG.judgeModel,
    timeoutMs: timeout ?? DEFAULT_LOCAL_MODEL_CONFIG.timeoutMs,
  }
}
