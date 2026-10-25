'use client'

// Fork（#30）：啟動任務中心、註冊通知文字、掛上任務抽屜。由 fork-services.tsx 掛一次。
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { notifyPendingAgentApproval } from '@/lib/agent/approval-notification'
import { setAgentTaskNotifier, startAgentTaskCenter } from '@/lib/agent-tasks'
import { AgentTasksSheet } from './agent-tasks-sheet'

export function AgentTaskService() {
  const t = useTranslations('agentTasks')

  useEffect(() => {
    void startAgentTaskCenter().catch(error => console.error('[agent-tasks] failed to start:', error))
  }, [])

  useEffect(() => {
    setAgentTaskNotifier((event, task) => {
      const title = t(`notify.${event}`)
      // App 在背景時發系統通知（函式內會判斷）；在前景時用 toast。
      void notifyPendingAgentApproval({ title, body: task.title })
      toast({ title, description: task.title, variant: event === 'failed' ? 'destructive' : 'default' })
    })
    return () => setAgentTaskNotifier(() => {})
  }, [t])

  return <AgentTasksSheet />
}
