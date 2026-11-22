// Fork（almanac ALMNC-54.21）：秘書在對話裡問 Scott、等他回話——給工作台「等你回話」用的明確標記（lib/threads/awaiting.ts）。
// - schedule_await_reply：秘書這一輪以問句收尾（例如要排哪一天）時呼叫，帶一行問題；執行結束才記，工具本身不寫任何東西。
// - ask_user_question：選項卡開著的期間也算在等，選完或取消就拿掉。
// 純函式＋注入的 mark／clear，方便測試。
import type { AgentTool, AgentUserQuestion } from '@/lib/agent/types'

export const AWAIT_REPLY_TOOL_NAME = 'schedule_await_reply'

export function buildAwaitReplyTool(onAsk: (question: string) => void): AgentTool {
  return {
    name: AWAIT_REPLY_TOOL_NAME,
    title: '等 Scott 回話',
    description: 'Secretary: call this when your reply ends with an open question Scott must answer before you can go on with a task or appointment (for example which day or time). Pass that question as one short line in Scott\'s language, then ask it in your reply. It shows the question on Scott\'s workbench under "waiting for your reply" until he answers in this conversation. It writes nothing. Do not use it for questions with concrete options (use ask_user_question) or for rhetorical questions.',
    category: 'system',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', minLength: 1, maxLength: 200, description: 'The question to Scott, one line.' } },
      required: ['question'],
      additionalProperties: false,
    },
    execute: async input => {
      const question = typeof input.question === 'string' ? input.question.replace(/\s+/g, ' ').trim() : ''
      if (!question) return { ok: false, error: 'QUESTION_REQUIRED', message: 'Pass the question to Scott as one short line.' }
      onAsk(question)
      return { ok: true, message: 'Noted: the question will wait on Scott\'s workbench until he replies. Now ask it in your reply and stop; do not guess the answer.' }
    },
  }
}

/** ask_user_question 的問題合成一行（多題用「／」接起來）與選項（只有一題時才帶）。 */
export function questionLine(questions: readonly AgentUserQuestion[]): { question: string, choices?: string[] } {
  const question = questions.map(entry => entry.question.trim()).filter(Boolean).join(' ／ ')
  const only = questions.length === 1 ? questions[0] : undefined
  return { question, ...(only && !only.multiSelect ? { choices: only.options.map(option => option.label) } : {}) }
}

/** 包住 ask_user_question：問題開著時記一筆 live，結束（選了、取消、失敗）就拿掉。 */
export function withAwaitingQuestion(tool: AgentTool, hooks: { open: (line: { question: string, choices?: string[] }) => void, close: () => void }): AgentTool {
  return {
    ...tool,
    execute: async (input, context) => {
      const questions = Array.isArray(input.questions) ? input.questions as AgentUserQuestion[] : []
      const valid = questions.filter(entry => entry && typeof entry.question === 'string' && Array.isArray(entry.options))
      if (valid.length) hooks.open(questionLine(valid.map(entry => ({ ...entry, options: entry.options.filter(option => option && typeof option.label === 'string') }))))
      try {
        return await tool.execute(input, context)
      } finally {
        if (valid.length) hooks.close()
      }
    },
  }
}
