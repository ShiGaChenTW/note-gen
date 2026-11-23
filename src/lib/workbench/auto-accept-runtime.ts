import { isTauri } from '@tauri-apps/api/core'
import { dependsOnPendingDraft } from '@/lib/agent-tasks/draft'
import { isAgentRunnerKind, type AgentTask, type DraftChange } from '@/lib/agent-tasks/types'
import { isUiV3 } from '@/lib/fork-ui'
import { planOf } from '@/lib/organize/drafts'
import { currentWorkspaceIdentity, inspectNote } from '@/lib/organize/vault-io'
import { applyOps } from '@/lib/ops/runtime'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import { linkEditOf, tryAutoAcceptLink, type AutoAcceptCandidate } from './auto-accept'
import { useAutoAcceptSettings } from './auto-accept-settings'
import { draftLinkCandidate } from './auto-accept-sources'

export function autoAcceptWorkspace(): string | undefined {
  if (isTauri() && isUiV3() && useSettingsHydrationStore.getState().status === 'ready') {
    return useSettingStore.getState().workspacePath || ''
  }
}

export async function autoAcceptLink(candidate: AutoAcceptCandidate, workspace: string, identity?: string): Promise<boolean> {
  const canWrite = () => autoAcceptWorkspace() === workspace && useAutoAcceptSettings.getState().enabled
  try {
    await useAutoAcceptSettings.getState().load()
    if (!canWrite()) return false
    const scope = identity ?? await currentWorkspaceIdentity()
    const actorId = candidate.actorId ?? (await (await import('@/db/agents')).listAgentSettings().catch(() => []))
      .find(agent => agent.role === candidate.actor)?.id
    return tryAutoAcceptLink({ ...candidate, actorId }, {
      enabled: canWrite(),
      isScottPinned: async change => (await import('@/lib/moc/scott-pins-runtime')).isScottPinnedChange(change),
      applyOps: (specs, context, options) => applyOps(specs, context, { ...options, workspace, identity: scope, canWrite }),
    })
  } catch (error) {
    console.debug('[workbench] auto-accept unavailable:', error)
    return false
  }
}

export async function autoAcceptTaskDrafts(task: AgentTask, workspace: string): Promise<DraftChange[]> {
  if (autoAcceptWorkspace() !== workspace) return task.drafts
  const drafts: DraftChange[] = []
  for (const draft of task.drafts) {
    let accepted = false
    try {
      const candidate = draftLinkCandidate(task, draft)
      if (candidate && linkEditOf(candidate) && !dependsOnPendingDraft(draft, task.drafts)) {
        const args = planOf(draft)
        const identity = args?.workspaceIdentity
        const current = !args || (args.workspace === workspace && identity !== undefined
          && (await Promise.all(Object.entries(args.plan.mtimes).map(async ([path, mtime]) =>
            (await inspectNote(path, identity))?.mtime === mtime))).every(Boolean))
        if (current) {
          if (isAgentRunnerKind(task.kind)) {
            const { getAgentSettings } = await import('@/db/agents')
            const agent = await getAgentSettings(task.kind.slice('agent:'.length))
            if (agent) accepted = await autoAcceptLink({ ...candidate, actor: agent.role, actorId: agent.id }, workspace, identity)
          } else {
            accepted = await autoAcceptLink(candidate, workspace, identity)
          }
        }
      }
    } catch (error) {
      console.debug('[workbench] draft auto-accept deferred to review:', error)
    }
    drafts.push(accepted ? { ...draft, state: 'applied' } : draft)
  }
  return drafts
}
