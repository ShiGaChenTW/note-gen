'use client'

// Fork（almanac ALMNC-54.4）：對話的標籤（查詢／處理／日程）。
// - ThreadTagPrefix：加在對話名稱最前面，寫成「查詢｜名稱」。
// - ThreadStatusBar：對話面板標題下面一行。新對話還沒有訊息時選對象（標籤）；開始後只能「交給指揮官」升級成處理；
//   日程對話問到筆記或知識時，秘書在這裡問要不要轉給指揮官（只提示，不自動轉）。
// 判斷都在 lib/threads/tags.ts，這裡只畫。
// Fork（almanac ALMNC-54.5）：同一行右邊顯示「還有 N 則提案待決定」——對話不結案，只提醒還有幾則沒決定。
import { useEffect, useMemo, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/v3/segmented'
import { useUiV3 } from '@/lib/fork-ui'
import { usePendingCounts } from '@/lib/decide/use-decisions'
import { canChangeTag, DEFAULT_THREAD_TAG, tagOf, transferSuggestion, THREAD_TAGS, type ThreadTag } from '@/lib/threads/tags'
import useChatStore from '@/stores/chat'
import useThreadsStore from '@/stores/threads'

export function ThreadTagPrefix({ tag }: { tag: ThreadTag }) {
  const t = useTranslations('threads.tag')
  return <span data-slot="thread-tag" data-tag={tag} className="shrink-0 text-muted-ink">{t(tag)}｜</span>
}

/** 目前對話的標籤；新對話還沒建立時用選好的草稿標籤。 */
export function useCurrentThreadTag(): ThreadTag {
  const conversations = useChatStore(state => state.conversations)
  const currentId = useChatStore(state => state.currentConversationId)
  const tagMap = useThreadsStore(state => state.tagMap)
  const draft = useThreadsStore(state => state.draftTag)
  const conversation = conversations.find(entry => entry.id === currentId)
  if (!conversation) return draft?.tag ?? DEFAULT_THREAD_TAG
  return tagOf(tagMap, conversation)
}

/** 還有幾則提案待決定（等接受或放棄的、再次討論中的都算）；沒有就不顯示。 */
export function PendingProposalsNote({ count, className }: { count: number, className?: string }) {
  const t = useTranslations('threads')
  if (count <= 0) return null
  return <span data-slot="thread-pending" className={className ?? 'shrink-0 text-muted-ink tabular-nums'}>{t('pending', { count })}</span>
}

export function ThreadStatusBar({ trailing }: { trailing?: ReactNode }) {
  const t = useTranslations('threads.tag')
  const isV3 = useUiV3()
  const conversations = useChatStore(state => state.conversations)
  const currentId = useChatStore(state => state.currentConversationId)
  const chats = useChatStore(state => state.chats)
  const temporary = useChatStore(state => state.isTemporaryConversation)
  const loadProjects = useThreadsStore(state => state.loadProjects)
  const setTag = useThreadsStore(state => state.setTag)
  const setDraftTag = useThreadsStore(state => state.setDraftTag)
  const claimDraft = useThreadsStore(state => state.claimDraftTag)
  const commanderJoins = useThreadsStore(state => state.commanderJoins)
  const dismissed = useThreadsStore(state => state.transferDismissed)
  const dismissTransfer = useThreadsStore(state => state.dismissTransfer)
  const tag = useCurrentThreadTag()
  const pendingCounts = usePendingCounts()

  const conversation = conversations.find(entry => entry.id === currentId)
  const hasMessages = (conversation?.messageCount ?? 0) > 0 || chats.length > 0
  const suggestion = useMemo(() => transferSuggestion(tag, chats, new Set(dismissed)), [tag, chats, dismissed])

  // 標籤對照表平常跟著對話頁載入；右側欄也要顯示標籤，所以這裡也確保載入一次。
  useEffect(() => {
    if (isV3) void loadProjects()
  }, [isV3, loadProjects])
  // 新對話送出第一則訊息後才有 id：把先選好的標籤補上。
  useEffect(() => {
    void claimDraft(conversations, currentId)
  }, [conversations, currentId, claimDraft])

  if (!isV3 || temporary) return null

  function choose(next: ThreadTag) {
    if (!canChangeTag(tag, next, hasMessages)) return
    if (conversation) void setTag(conversation, next)
    else setDraftTag(next)
  }

  return (
    <div data-slot="thread-status" className="w-full shrink-0 border-b border-line-soft px-3 py-1.5 text-ui-compact">
      <div className="flex min-h-7 items-center gap-2">
        {hasMessages ? (
          <>
            <span className="shrink-0 rounded-(--r-kbd) bg-hover px-1.5 leading-5 text-muted-ink" data-slot="thread-tag-label">{t(tag)}</span>
            <span className="min-w-0 flex-1 truncate text-muted-ink">{t(`hint.${tag}`)}</span>
            {tag !== 'process' && conversation && (
              <Button size="sm" variant="outline" className="h-7 shrink-0" title={t('handoffHint')} onClick={() => void commanderJoins(conversation)}>
                {t('handoff')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Segmented
              label={t('label')}
              value={tag}
              onChange={choose}
              compact
              items={THREAD_TAGS.map(value => ({ value, label: t(value) }))}
              className="shrink-0 [&>button]:text-ui-compact"
            />
            <span className="min-w-0 flex-1 truncate text-muted-ink">{t(`hint.${tag}`)}</span>
          </>
        )}
        {currentId !== null && <PendingProposalsNote count={pendingCounts.get(currentId) ?? 0} />}
        {trailing}
      </div>
      {suggestion !== null && conversation && (
        <div className="mt-1.5 flex items-center gap-2 rounded-(--r-kbd) border border-dashed border-line px-2.5 py-1.5" data-slot="thread-transfer" role="status">
          <span className="min-w-0 flex-1 text-ink">{t('transferAsk')}</span>
          <Button size="sm" className="h-7" onClick={() => void commanderJoins(conversation)}>{t('transfer')}</Button>
          <Button size="sm" variant="ghost" className="h-7 text-muted-ink" onClick={() => dismissTransfer(suggestion)}>{t('keep')}</Button>
        </div>
      )}
    </div>
  )
}
