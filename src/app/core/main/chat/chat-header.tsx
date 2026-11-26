"use client"

import { useState, useMemo } from 'react'
import { MessageSquareDashed, MessageSquarePlus, ChevronDown, Search, Trash2, Ellipsis, NotebookPen } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import { ConversationSummaryButton } from "../conversation-summary/summary-dialog" // Fork #33
import { CreateJobButton } from '../jobs/create-job'
import { EmptyState } from '@/components/v3/empty-state'
import useChatStore from "@/stores/chat"
import useThreadsStore from '@/stores/threads'
import { ThreadTagPrefix, useCurrentThreadTag } from '../threads/thread-status' // Fork（almanac ALMNC-54.4）
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLocale, useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import 'dayjs/locale/pt-br'
import 'dayjs/locale/de'
import 'dayjs/locale/zh-tw'
import useSettingStore from '@/stores/setting'
import { useChatV3 } from './chat-v3'
import { useConversationSummaryStore } from '@/lib/conversation-summary'
import { cn } from '@/lib/utils'

dayjs.extend(relativeTime)

function formatRelativeTime(timestamp: number, locale: string): string {
  let dayjsLocale = 'en'
  if (locale === '简体中文' || locale === 'zh') dayjsLocale = 'zh-cn'
  else if (locale === '繁體中文' || locale === 'zh-TW') dayjsLocale = 'zh-tw'
  else if (locale === '日本語' || locale === 'ja') dayjsLocale = 'ja'
  else if (locale === 'Português' || locale === 'pt-BR') dayjsLocale = 'pt-br'
  else if (locale === 'Deutsch' || locale === 'de') dayjsLocale = 'de'
  return dayjs(timestamp).locale(dayjsLocale).fromNow()
}

export function ChatHeader() {
  const v3 = useChatV3()
  const inThreads = useThreadsStore(state => v3 && state.chatHost !== null)
  const locale = useLocale()
  const tV3 = useTranslations('record.chat.v3')
  const openSummary = useConversationSummaryStore(state => state.open)
  const {
    startNewConversation,
    startTemporaryConversation,
    conversations,
    currentConversationId,
    isTemporaryConversation,
    switchConversation,
    deleteConversation,
    chats,
    loading,
  } = useChatStore()
  const { language } = useSettingStore()
  const t = useTranslations()
  const tEmpty = useTranslations('record.chat.empty')

  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  // 没有消息或正在加载时禁用新对话按钮
  const hasCurrentMessages = isTemporaryConversation
    ? chats.length > 0
    : conversations.some(c => c.id === currentConversationId && c.messageCount > 0)
  const isDisabled = (!hasCurrentMessages && !isTemporaryConversation) || loading

  // 过滤并排序会话（排除空会话）
  const filteredConversations = useMemo(() => {
    return conversations
      .filter(c => c.messageCount > 0)
      .filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return b.updatedAt - a.updatedAt
      })
  }, [conversations, searchQuery])

  // 当前会话标题（如果有消息的话）
  const currentConversation = conversations.find(c => c.id === currentConversationId)
  // Fork（almanac ALMNC-54.4）：v3 的對話名稱前面加標籤，寫成「查詢｜名稱」。
  const currentTag = useCurrentThreadTag()
  const dropdownTitle = currentConversation && currentConversation.messageCount > 0
    ? currentConversation.title
    : v3 && !inThreads ? tV3('newChat') : tEmpty('conversationHistory')

  return (
    <>
      <header className={cn("h-12 w-full flex items-center justify-between border-b px-4 gap-2", v3 && "h-11 shrink-0 border-line-soft px-2 pl-3")}>
      {/* 左侧：历史对话下拉 */}
      <div className={cn("flex items-center gap-2", v3 && "min-w-0 flex-1")}>
        {isTemporaryConversation && !v3 ? (
          <div className="flex items-center gap-2 px-2 text-sm font-medium text-muted-foreground">
            <MessageSquareDashed className="size-4" />
            <span>{t('record.chat.input.temporaryChat')}</span>
          </div>
        ) : (
          <DropdownMenu open={showHistoryDropdown} onOpenChange={setShowHistoryDropdown}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn("px-2 hover:bg-transparent cursor-pointer justify-start gap-1.5", v3 && "h-8 min-w-0 px-1 text-ink hover:bg-hover")}
                title={v3 ? tEmpty('conversationHistory') : undefined}
              >
                <span className={cn("text-sm font-medium truncate max-w-30", v3 && "min-w-0 max-w-full text-ui-compact")}>
                  {v3 && !isTemporaryConversation && currentConversation && currentConversation.messageCount > 0 && <ThreadTagPrefix tag={currentTag} />}
                  {v3 && isTemporaryConversation ? tV3('temporaryChat') : dropdownTitle}
                </span>
                {!v3 && <span className="text-xs text-muted-foreground">
                  ({filteredConversations.length})
                </span>}
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-75 max-h-100 overflow-y-auto"
            >
              <div className="px-2 py-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={tEmpty('searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={v3 ? e => {
                      if (!['Escape', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.stopPropagation()
                    } : undefined}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              </div>
              <DropdownMenuSeparator />
              {filteredConversations.length === 0 ? (v3 ? (
                <EmptyState className="px-4 py-3" text={searchQuery ? tEmpty('noMatchingConversations') : tEmpty('noConversationHistory')} />
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {searchQuery ? tEmpty('noMatchingConversations') : tEmpty('noConversationHistory')}
                </div>
              )) : (
                <div className="max-h-75 overflow-y-auto">
                  {filteredConversations.map(conv => (
                    <DropdownMenuItem
                      key={conv.id}
                      className="cursor-pointer group"
                      onSelect={v3 ? () => { void switchConversation(conv.id) } : undefined}
                    >
                      <div
                        className="flex-1 min-w-0"
                        onClick={v3 ? undefined : () => switchConversation(conv.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm truncate group-hover:text-ink transition-colors">
                              {conv.title}
                            </span>
                          </div>
                          <div className="shrink-0 ml-auto flex items-center gap-2">
                            <span className={cn("text-xs text-muted-foreground", v3 && "tabular-nums")}>
                              {v3 && locale === 'zh-TW'
                                ? dayjs(conv.updatedAt).locale('zh-tw').fromNow()
                                : formatRelativeTime(conv.updatedAt, v3 ? locale : language)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                setShowHistoryDropdown(false)
                                setPendingDeleteId(conv.id)
                              }}
                              className={cn("flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out hover:text-destructive hover:bg-destructive/10 active:scale-95",
                                v3 && "size-7 opacity-100 hover:bg-hover hover:text-danger")}
                              aria-label={tEmpty('deleteConversation')}
                              title={tEmpty('deleteConversation')}
                            >
                              <Trash2 className="w-3.5 h-3.5 transition-transform duration-150 group-hover/button:scale-110" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* 右侧：临时会话与新建对话 */}
      <div className={cn("flex items-center gap-1", v3 && "shrink-0")}>
        {!v3 && <>
          <ConversationSummaryButton conversationId={isTemporaryConversation ? null : currentConversationId} disabled={loading} />
          <TooltipButton
            icon={<MessageSquareDashed />}
            tooltipText={t('record.chat.input.temporaryChat')}
            side="bottom"
            onClick={startTemporaryConversation}
            disabled={loading || isTemporaryConversation}
            variant={isTemporaryConversation ? 'secondary' : 'ghost'}
          />
        </>}
        {inThreads && <CreateJobButton />}
        {!inThreads && <TooltipButton
          icon={<MessageSquarePlus />}
          tooltipText={v3 ? tV3('newChat') : t('record.chat.input.newChat')}
          buttonClassName={v3 ? 'size-8 text-muted-ink hover:bg-hover hover:text-ink' : undefined}
          side="bottom"
          onClick={() => startNewConversation()}
          disabled={isDisabled}
        />}
        {v3 && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-ink hover:bg-hover hover:text-ink"
              aria-label={tV3('more')} title={tV3('more')}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={loading || isTemporaryConversation} onSelect={() => { void startTemporaryConversation() }}>
              <MessageSquareDashed />{tV3('temporaryChat')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={loading || isTemporaryConversation || currentConversationId === null}
              onSelect={() => { if (currentConversationId !== null) openSummary(currentConversationId) }}>
              <NotebookPen />{tV3('summary')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      </header>

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tEmpty('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{tEmpty('deleteConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tEmpty('deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDeleteId !== null) {
                  void deleteConversation(pendingDeleteId)
                  setPendingDeleteId(null)
                }
              }}
            >
              {tEmpty('deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
