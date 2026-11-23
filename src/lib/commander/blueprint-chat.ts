import type { AgentTool } from '@/lib/agent/types'
import { dispatchExplore } from '@/lib/domain-page/explore'
import { blueprintLine } from './blueprint'

export const EXPLORE_TOOL_NAME = 'propose_domain_blueprint'

export function buildExploreTool(): AgentTool {
  return {
    name: EXPLORE_TOOL_NAME,
    title: 'Propose domain blueprint',
    category: 'note',
    risk: 'medium',
    description: 'When Scott asks to systematically explore or learn a topic, propose a domain blueprint on the workbench. Provide the topic or learning goal in his language. The vault changes only after he accepts.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'], additionalProperties: false },
    execute: async ({ topic }, context) => {
      const text = blueprintLine(topic)
      if (!text || context.signal?.aborted) return { ok: false, message: 'A topic is required to draft a domain blueprint.' }
      try {
        if (!await dispatchExplore({ origin: 'conversation', topic: text })) return { ok: false, message: 'Exploration is unavailable.' }
        return { ok: true, message: 'The domain blueprint is ready on the workbench for Scott to review.' }
      } catch {
        return { ok: false, message: 'The commander could not draft the blueprint. The vault has not changed.' }
      }
    },
  }
}
