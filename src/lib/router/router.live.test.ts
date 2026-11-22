// Fork（almanac ALMNC-54.11）：用本機 ollama 實際跑一次 ALMNC-54.9 的 40 句，確認 TS 版和 Python 實測（rules_eval.py）一致。
// 預設跳過；要跑：ollama 開著、有 qwen3-embedding:0.6b，然後
//   RUN_OLLAMA=1 npx vitest run src/lib/router/router.live.test.ts
// 可用 OLLAMA_URL、EMB_MODEL 換位址與模型。實測（溫度 0.02、門檻 0.7、加規則）：自動 28 句、錯 1 句、問 Scott 12 句。
import { describe, expect, it } from 'vitest'
import { createLocalModelClient, DEFAULT_LOCAL_MODEL_CONFIG, type FetchLike } from '@/lib/local-model/client'
import { createRouter, type Route } from './router'
import spike from './spike-commands.json'

describe.skipIf(!process.env.RUN_OLLAMA)('router against local ollama (RUN_OLLAMA=1)', () => {
  it('matches the spike: ~28/40 automatic with 1 wrong at T=0.02 / 0.7', async () => {
    const model = createLocalModelClient({
      ...DEFAULT_LOCAL_MODEL_CONFIG,
      endpoint: process.env.OLLAMA_URL || DEFAULT_LOCAL_MODEL_CONFIG.endpoint,
      embeddingModel: process.env.EMB_MODEL || DEFAULT_LOCAL_MODEL_CONFIG.embeddingModel,
      timeoutMs: 60_000,
    }, { fetch: globalThis.fetch as unknown as FetchLike })
    expect(await model.available()).toBe(true)
    const router = createRouter({ model })
    let auto = 0
    let wrong = 0
    const lines: string[] = []
    for (const command of spike.commands as Array<{ text: string, gold: Route }>) {
      const decision = await router.route(command.text)
      const ok = decision.route === command.gold
      if (decision.route) {
        auto++
        if (!ok) wrong++
      }
      lines.push(`${decision.route ? (ok ? 'ok ' : 'BAD') : 'ask'} ${decision.layer.padEnd(5)} ${decision.confidence.toFixed(3)} ${command.gold.padEnd(10)} ${(decision.route ?? decision.suggestion ?? '-').padEnd(10)} ${command.text}`)
    }
    console.log([...lines, `auto ${auto}/40, wrong ${wrong}, ask ${40 - auto}`].join('\n'))
    expect(auto).toBeGreaterThanOrEqual(25)
    expect(auto).toBeLessThanOrEqual(31)
    expect(wrong).toBeLessThanOrEqual(2)
  }, 120_000)
})
