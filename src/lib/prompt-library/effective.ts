// Fork（almanac ALMNC-86）：提示詞功能關閉（PROMPT_LIBRARY_ENABLED=false）時，以前設過的 Agent 自訂指引、
// 自訂對話角色與「用這個提示詞開新對話」的對話提示詞都看不到也改不了，所以一律不生效、改用預設。
// 只在讀取時忽略，store.json 與對話紀錄裡的原值都不動；開關改回 true 就照原值生效。
import { PROMPT_LIBRARY_ENABLED } from './feature'

export function isPromptLibraryEnabled(): boolean {
  return PROMPT_LIBRARY_ENABLED
}

/** 對話層級的系統提示詞（conversation_prompt）。功能關閉時忽略。 */
export function resolveConversationSystemPrompt(override: string | null | undefined): string | undefined {
  if (!isPromptLibraryEnabled()) return undefined
  return override?.trim() || undefined
}

/** 實際生效的對話角色。功能關閉時一律用預設角色（isDefault，沒有就第一個）。 */
export function resolveEffectivePrompt<T extends { id: string; isDefault?: boolean }>(
  promptList: readonly T[] | null | undefined,
  currentPrompt: T | null | undefined,
): T | null {
  if (isPromptLibraryEnabled()) return currentPrompt ?? null
  const list = promptList ?? []
  return list.find(prompt => prompt.isDefault) ?? list[0] ?? null
}
