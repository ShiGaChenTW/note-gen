import type { MemoryAgent } from '@/db/agent-memory'
import { isMobileDevice } from '@/lib/check'
import { isUiV3 } from '@/lib/fork-ui'
import { askCollectModel } from '@/lib/collect/ai'
import { createTranslator } from 'next-intl'
import { LANGUAGE_STORAGE_KEY, loadMessagesWithFallback, normalizeLocale } from '@/i18n/config'
import { learnFromCompletedWork, type CompletedRoleWork } from './completion'

/** 共用完成鉤子：背景任務、資料源分析、右側欄。記憶更新失敗不改原本工作的結果。 */
export async function rememberCompletedRoleWork(
  agent: MemoryAgent,
  work: CompletedRoleWork,
  ask = (prompt: string) => askCollectModel(prompt, undefined, { silent: true }),
): Promise<void> {
  if (!isUiV3() || isMobileDevice() || typeof window === 'undefined' || window.location.pathname.startsWith('/mobile')) return
  try {
    const memory = await import('@/db/agent-memory')
    await learnFromCompletedWork(agent, work, {
      ask,
      io: {
        appendWorkNotes: memory.appendAgentWorkNotes,
        mergeContext: memory.mergeSharedContext,
        readRules: async target => (await memory.getAgentMemory(target)).rules.content,
        submitRules: async (target, change) => {
          const { default: useCollectStore } = await import('@/stores/collect')
          const locale = normalizeLocale(window.localStorage?.getItem(LANGUAGE_STORAGE_KEY))
          const t = createTranslator({ locale, messages: await loadMessagesWithFallback(locale), namespace: 'agents.memory' })
          const title = t('rulesProposal', { name: target.name })
          const collect = useCollectStore.getState()
          await collect.hydrate()
          const id = `rules:${target.id}:${work.reference}`
          collect.addProposals(id, target.name, [{
            id: 'rules',
            kind: 'note',
            title,
            body: '',
            due: '',
            time: '',
            tags: [],
            card: { label: 'review', verb: 'modify' },
            memoryEdits: [{ target: 'rules', agent: target, baseContent: change.before, content: change.after, summary: title }],
          }], { conversationId: work.conversationId })
          await collect.persist()
        },
      },
    })
  } catch (error) {
    console.warn('[agent-memory] completed work not recorded:', error)
  }
}
