'use client'

// Fork（#32）：Agent 任務卡。主欄顯示背景任務四組狀態與最近對話；
// 「需要你處理」放待審草稿與沒做完的任務。#33 完成前不顯示「摘要」按鈕。
import { useTranslations } from 'next-intl'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { agentTaskCenter, useAgentTaskStore } from '@/lib/agent-tasks'
import type { AgentTaskStatus } from '@/lib/agent-tasks/types'
import { cn } from '@/lib/utils'
import useChatStore from '@/stores/chat'
import useHomeStore from '@/stores/home'
import { useSidebarStore } from '@/stores/sidebar'
import type { NeedItem } from '../home-cards'
import { openTasks } from './needs-list'

const STATUS_TONE: Record<AgentTaskStatus, string> = {
  awaiting_review: 'text-primary',
  queued: 'text-sky-500',
  running: 'text-sky-500',
  interrupted: 'text-destructive',
  failed: 'text-destructive',
  completed: 'text-emerald-600 dark:text-emerald-400',
  cancelled: 'text-muted-foreground',
}

export function useTaskNeeds(): NeedItem[] {
  const t = useTranslations('home.needs')
  const tasks = useAgentTaskStore(state => state.tasks)
  const out: NeedItem[] = []
  for (const task of tasks) {
    if (task.status === 'awaiting_review') {
      const pending = task.drafts.filter(draft => draft.state === 'pending').length
      out.push({ key: `task:${task.id}`, label: t('review'), tone: 'primary', text: task.title, meta: t('drafts', { count: pending }), action: t('reviewAction'), onAction: () => openTasks(task.id) })
    } else if (task.status === 'interrupted' || task.status === 'failed') {
      out.push({ key: `task:${task.id}`, label: t('unfinished'), tone: 'destructive', text: task.title, meta: task.error, action: t('resume'), onAction: () => void agentTaskCenter.resume(task.id) })
    }
  }
  return out
}

function isToday(ms: number | undefined) {
  if (!ms) return false
  return new Date(ms).toDateString() === new Date().toDateString()
}

export function TasksSection() {
  const t = useTranslations('home.tasks')
  const tStatus = useTranslations('agentTasks.status')
  const tasks = useAgentTaskStore(state => state.tasks)
  const conversations = useChatStore(state => state.conversations)
  const hide = useHomeStore(state => state.hide)
  // 進行中＋今天完成的；等你回應與沒做完的已經在「需要你處理」
  const shown = tasks
    .filter(task => task.status === 'running' || task.status === 'queued' || ((task.status === 'completed' || task.status === 'cancelled') && isToday(task.finishedAt)))
    .slice(0, 6)
  const recent = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)

  async function openConversation(id: number) {
    await useChatStore.getState().switchConversation(id)
    if (!useSidebarStore.getState().rightSidebarVisible) await useSidebarStore.getState().toggleRightSidebar()
    hide()
  }

  return (
    <section className="rounded-xl bg-background p-4" aria-labelledby="home-tasks">
      <header className="mb-2 flex items-center gap-2">
        <h2 id="home-tasks" className="text-[15px] font-semibold">{t('title')}</h2>
        <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => openTasks()}>{t('viewAll')}</Button>
      </header>
      {shown.length === 0
        ? <p className="px-1 py-2 text-sm text-muted-foreground">{t('empty')}</p>
        : (
          <ul className="grid gap-0.5">
            {shown.map(task => (
              <li key={task.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
                <span className={cn('w-16 shrink-0 text-xs', STATUS_TONE[task.status])}>{tStatus(task.status)}</span>
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => openTasks()}>{task.title}</button>
                {task.tokens > 0 && <span className="text-xs tabular-nums text-muted-foreground">{task.tokens.toLocaleString()} tokens</span>}
                {(task.status === 'running' || task.status === 'queued') && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void agentTaskCenter.cancel(task.id)}>{t('cancel')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}

      <h3 className="mt-3 mb-1 border-t pt-3 text-xs font-semibold text-muted-foreground">{t('conversations')}</h3>
      {recent.length === 0
        ? <p className="px-1 py-1 text-sm text-muted-foreground">{t('noConversations')}</p>
        : (
          <ul className="grid gap-0.5">
            {recent.map(conversation => (
              <li key={conversation.id}>
                <button type="button" className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-muted" onClick={() => void openConversation(conversation.id)}>
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                  <span className="text-xs text-muted-foreground">{new Date(conversation.updatedAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

