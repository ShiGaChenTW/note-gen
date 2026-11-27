// Fork（almanac ALMNC-91）：專家只看筆記庫、不查外部資料（lib/agents/instructions.ts）。
// 專家判斷問題需要外部資料時，呼叫 expert_suggest_commander 記下這則回答；對話裡就在那則回答下面問 Scott 要不要轉給指揮官。
// 只提示，不自動轉：Scott 按「轉給指揮官」才把標籤改成處理、把原問題送給指揮官；按「不用」後同一則訊息不再問。
// 秘書的同類提示見 lib/threads/tags.ts transferSuggestion。這裡全是純函式，加上工具定義。
import type { AgentTool } from '@/lib/agent/types'
import type { ChatLike, ThreadTag } from './tags'

export const EXPERT_HANDOFF_TOOL_NAME = 'expert_suggest_commander'

/** 給專家的工具：判斷需要外部資料時呼叫。不寫任何東西，只記下「這則回答要問 Scott 要不要轉給指揮官」。 */
export function buildExpertHandoffTool(onSuggest: (reason: string) => void): AgentTool {
  return {
    name: EXPERT_HANDOFF_TOOL_NAME,
    title: '提議轉給指揮官',
    description: 'Expert: call this when answering Scott\'s question needs external sources you cannot use (the web, current news or prices, data that is not in the vault). Pass a one-line reason in Scott\'s language. Scott is then asked whether to hand the question to the commander; nothing is handed over unless he agrees. It writes nothing. Do not call it when the notes answer the question.',
    category: 'system',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', minLength: 1, maxLength: 200, description: 'Why external sources are needed, one line.' } },
      required: ['reason'],
      additionalProperties: false,
    },
    execute: async input => {
      const reason = typeof input.reason === 'string' ? input.reason.replace(/\s+/g, ' ').trim() : ''
      if (!reason) return { ok: false, error: 'REASON_REQUIRED', message: 'Pass a one-line reason why external sources are needed.' }
      onSuggest(reason)
      return { ok: true, message: 'Noted: Scott will be asked whether to hand this question to the commander. Answer from the notes as far as they go, say plainly what needs external sources, and do not guess or look anything up yourself.' }
    },
  }
}

/** 接在專家只讀回答的系統提示詞後面：告訴他什麼時候用 expert_suggest_commander。 */
export const EXPERT_HANDOFF_RULE = `If the question needs external sources (the web, current news or prices, data not in the vault), answer from the notes as far as they go, say what is missing, and call ${EXPERT_HANDOFF_TOOL_NAME}. Never claim you looked something up.`

/**
 * 專家這則回答（chatId）要不要在下面問 Scott 轉給指揮官；要的話回傳原問題（這則回答前面最近一則 Scott 的訊息）。
 * 條件：查詢對話、專家記下需要外部資料、Scott 還沒對這則回答說「不用」、而且這是最新問題的回答（Scott 又問了別的就不再問舊的）。
 */
export function expertHandoffQuestion(
  tag: ThreadTag,
  chats: readonly ChatLike[],
  chatId: number,
  flagged: ReadonlySet<number>,
  dismissed: ReadonlySet<number> = new Set(),
): string | null {
  if (tag !== 'query' || !flagged.has(chatId) || dismissed.has(chatId)) return null
  const index = chats.findIndex(chat => chat.id === chatId)
  if (index < 0) return null
  if (chats.slice(index + 1).some(isScottMessage)) return null
  for (let at = index - 1; at >= 0; at--) {
    const chat = chats[at]
    if (!isScottMessage(chat)) continue
    const question = (chat.content ?? '').trim()
    return question || null
  }
  return null
}

function isScottMessage(chat: ChatLike): boolean {
  return chat.role === 'user' && chat.type === 'chat'
}
