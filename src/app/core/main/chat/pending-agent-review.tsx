import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import { AgentApprovalPanel } from './agent-approval-panel'
import { AgentQuestionPanel } from './agent-question-panel'
import { cancelPendingAgentAction, confirmPendingAgentAction, getActionableConfirmation } from './agent-approval-actions'

export function PendingAgentReview() {
  const chat = useChatStore()
  const workspacePath = useSettingStore(state => state.workspacePath)
  const approval = getActionableConfirmation(chat, workspacePath)?.pendingConfirmation

  return (
    <div className="max-h-[45%] w-full shrink-0 overflow-y-auto px-3 empty:hidden">
      {approval && (
        <AgentApprovalPanel key={approval.id ?? approval.traceEventId ?? approval.toolName} docked
          pendingConfirmation={approval}
          onConfirm={scope => confirmPendingAgentAction(scope, approval.id)}
          onCancel={() => cancelPendingAgentAction(approval.id)}
        />
      )}
      <AgentQuestionPanel docked />
    </div>
  )
}
