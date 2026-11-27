'use client'

// Fork（almanac ALMNC-91）：專家判斷需要外部資料的回答下面，問 Scott 要不要轉給指揮官。
// 只提示，不自動轉：按「轉給指揮官」才改成處理並把原問題送給指揮官；按「不用」後同一則訊息不再問。
// 判斷都在 lib/threads/expert-handoff.ts，這裡只畫；外觀沿用秘書的同類提示（thread-status.tsx）。
import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useUiV3 } from '@/lib/fork-ui'
import { expertHandoffQuestion } from '@/lib/threads/expert-handoff'
import useChatStore from '@/stores/chat'
import useThreadsStore from '@/stores/threads'
import { useCurrentThreadTag } from './thread-status'

export function ExpertHandoffPrompt({ chatId }: { chatId: number }) {
  const t = useTranslations('threads.tag')
  const isV3 = useUiV3()
  const tag = useCurrentThreadTag()
  const chats = useChatStore(state => state.chats)
  const conversation = useChatStore(state => state.conversations.find(entry => entry.id === state.currentConversationId))
  const flagged = useThreadsStore(state => state.expertHandoffs)
  const dismissed = useThreadsStore(state => state.transferDismissed)
  const dismiss = useThreadsStore(state => state.dismissTransfer)
  const handOver = useThreadsStore(state => state.handExpertQuestionToCommander)
  const question = useMemo(
    () => expertHandoffQuestion(tag, chats, chatId, new Set(flagged), new Set(dismissed)),
    [tag, chats, chatId, flagged, dismissed],
  )

  if (!isV3 || !conversation || question === null) return null
  return (
    <div className="mt-2 flex items-center gap-2 rounded-(--r-kbd) border border-dashed border-line px-2.5 py-1.5 text-ui-compact" data-slot="expert-handoff" role="status">
      <span className="min-w-0 flex-1 text-ink">{t('expertAsk')}</span>
      <Button size="sm" className="h-7" onClick={() => void handOver(conversation, chatId, t('expertMessage', { question }))}>{t('transfer')}</Button>
      <Button size="sm" variant="ghost" className="h-7 text-muted-ink" onClick={() => dismiss(chatId)}>{t('keep')}</Button>
    </div>
  )
}
