/**
 * 提示詞 frontmatter 的模型／temperature 建議（#57）：純函式，不碰 store／UI。
 * frontmatter 的 `model` 要對應使用者模型設定條目的「模型字串」（如 `claude-sonnet-5-5`），
 * 不是設定內部的隨機 id。只是建議，要使用者點了才套用；找不到對應條目就回傳 null，UI 灰化。
 */

import { collectGroupedChatModels } from '@/app/core/main/chat/model-selection'
import type { AiConfig } from '@/app/core/setting/config'

export interface PromptModelSuggestion {
  modelRef: string
  temperature?: number
}

export interface ResolvedPromptModelSuggestion {
  modelId: string
  modelLabel: string
  temperature?: number
}

/** frontmatter 的 model／temperature 欄位；格式不對（不是非空字串／有限數字）就當作沒有建議。 */
export function parsePromptModelSuggestion(
  frontmatter: Record<string, unknown> | null | undefined,
): PromptModelSuggestion | null {
  const modelRef = frontmatter?.model
  if (typeof modelRef !== 'string' || !modelRef.trim()) return null
  const temperature = frontmatter?.temperature
  return {
    modelRef: modelRef.trim(),
    temperature: typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : undefined,
  }
}

/** 以 frontmatter 的 model 字串比對使用者的模型設定條目（忽略大小寫）；找不到回傳 null。 */
export function resolvePromptModelSuggestion(
  suggestion: PromptModelSuggestion,
  aiModelList: AiConfig[] | undefined,
): ResolvedPromptModelSuggestion | null {
  const grouped = collectGroupedChatModels(aiModelList)
  const match = grouped.find(item => item.model.model.toLowerCase() === suggestion.modelRef.toLowerCase())
  if (!match) return null
  return {
    modelId: match.model.id,
    modelLabel: match.model.model,
    temperature: suggestion.temperature,
  }
}
