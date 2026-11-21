// Fork（almanac ALMNC-54.10）：App 內共用的本機模型客戶端。需要 Tauri 才跑得起來，單元測試直接用 client.ts 加假的 fetch。
// 設定放在 store.json 的 localModel（{ enabled, endpoint, embeddingModel, judgeModel, timeoutMs }），沒有就用預設值：
// ollama 在 http://localhost:11434、qwen3-embedding:0.6b、qwen3.5:2b。目前沒有設定畫面，要改就直接改 store.json。
// 請求走 @tauri-apps/plugin-http（src-tauri/capabilities/default.json 的 http:allow-fetch 已允許 http://*:*，含 localhost:11434），
// webview 直接 fetch 會被 CORS 擋。沒有 Tauri（瀏覽器預覽）時退回全域 fetch，ollama 沒開就是「無法使用」。
import { createLocalModelClient, sanitizeLocalModelConfig, type FetchLike, type LocalModel, type LocalModelConfig } from './client'

export const LOCAL_MODEL_STORE_KEY = 'localModel'

export async function loadLocalModelConfig(): Promise<LocalModelConfig> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load('store.json')
    return sanitizeLocalModelConfig(await store.get(LOCAL_MODEL_STORE_KEY))
  } catch {
    return sanitizeLocalModelConfig(undefined)
  }
}

async function appFetch(): Promise<FetchLike> {
  try {
    const { fetch } = await import('@tauri-apps/plugin-http')
    return fetch as unknown as FetchLike
  } catch {
    return globalThis.fetch as unknown as FetchLike
  }
}

let shared: Promise<LocalModel> | undefined

/** 第一次呼叫時讀設定、建立客戶端；之後共用（可用性快取也共用）。 */
export function defaultLocalModel(): Promise<LocalModel> {
  shared ??= (async () => createLocalModelClient(await loadLocalModelConfig(), { fetch: await appFetch() }))().catch(error => {
    shared = undefined
    throw error
  })
  return shared
}
