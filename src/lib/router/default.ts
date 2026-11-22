// Fork（almanac ALMNC-54.11）：路由器接到 App——共用的本機嵌入模型、角色名單、Scott 的偏好（#111）與「問 Scott」的選擇記錄。
// 需要 Tauri 才跑得起來；判斷本身的測試在 router.test.ts、sidebar.test.ts（假模型）。
import { createRouter, type RosterEntry, type Router } from './router'
import { addRouterChoice, ROUTER_CHOICES_KEY, type PreferenceStore, type RouterChoice } from './sidebar'

let shared: Router | undefined

/** App 內共用的路由器（範例句向量只算一次）。本機模型讀不到時路由器照樣能用：規則照判，其他問 Scott。 */
export async function defaultRouter(): Promise<Router> {
  if (shared) return shared
  try {
    const { defaultLocalModel } = await import('@/lib/local-model/default')
    shared = createRouter({ model: await defaultLocalModel() })
  } catch (error) {
    console.warn('[router] local model client unavailable:', error)
    return createRouter()
  }
  return shared
}

export async function loadRouterRoster(): Promise<RosterEntry[]> {
  try {
    const agents = await import('@/db/agents')
    await agents.ensureDefaultRoster().catch(() => false)
    return await agents.listAgentSettings()
  } catch {
    return []
  }
}

/** Scott 的偏好（所有夥伴共讀、只有 Scott 能改）。 */
export async function scottPreferenceStore(): Promise<PreferenceStore> {
  const memory = await import('@/db/agent-memory')
  return {
    get: async () => (await memory.getScottPreferences()).content,
    save: content => memory.saveScottPreferences('scott', content),
  }
}

/** 記下「問 Scott」時他選了哪一類（store.json 的 routerChoices，最多 200 筆）。失敗不影響送出。 */
export async function recordRouterChoice(choice: RouterChoice): Promise<void> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load('store.json')
    const current = await store.get(ROUTER_CHOICES_KEY)
    await store.set(ROUTER_CHOICES_KEY, addRouterChoice(Array.isArray(current) ? current as RouterChoice[] : [], choice))
    await store.save()
  } catch (error) {
    console.debug('[router] choice not recorded:', error)
  }
}
