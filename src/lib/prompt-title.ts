// Fork（almanac ALMNC-62）：內建預設提示詞的標題原本寫死簡體「写作助手」，而且第一次啟動時就存進 store.json，
// 改預設值救不回已安裝的使用者。所以在顯示時換成介面語言的名稱；使用者自己改過標題就照他改的顯示。
export const LEGACY_DEFAULT_PROMPT_TITLE = '写作助手'

export function displayPromptTitle(prompt: { title: string; isDefault?: boolean } | null | undefined, localizedDefault: string): string {
  if (!prompt) return ''
  return prompt.isDefault && prompt.title === LEGACY_DEFAULT_PROMPT_TITLE ? localizedDefault : prompt.title
}
