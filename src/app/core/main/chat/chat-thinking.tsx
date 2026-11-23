import { Chat } from "@/db/chats";
import { useState, useEffect, useRef } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useChatV3 } from "./chat-v3";
import { getReasoningLabel, isReasoningExpanded } from "./reasoning-display";

export default function ChatThinking({chat}: { chat: Chat }) {
  const t = useTranslations()
  const thinkingContent = chat.thinking || ''
  const isThinking = !chat.content && !!chat.thinking // 还在思考中（有 thinking 但没有 content）
  
  const v3 = useChatV3()
  const [isExpanded, setIsExpanded] = useState(isThinking)
  // V3：使用者手動切換後，不再被思考狀態自動覆蓋
  const [userExpanded, setUserExpanded] = useState<boolean | undefined>(undefined)
  const contentRef = useRef<HTMLDivElement>(null)
  
  // 当思考状态改变时，自动展开或折叠
  useEffect(() => {
    if (isThinking) {
      setIsExpanded(true)
    } else {
      setIsExpanded(false)
    }
  }, [isThinking])
  
  // 思考内容更新时，自动滚动到底部
  useEffect(() => {
    if (isThinking && isExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [thinkingContent, isThinking, isExpanded])
  
  if (!chat.thinking) {
    return null
  }

  // 提取标题（第一行或前50个字符）
  const extractTitle = (text: string): string => {
    const firstLine = text.split('\n')[0]
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...'
    }
    return firstLine || text.substring(0, 50) + '...'
  }
  
  const title = extractTitle(thinkingContent)
  // V3：chats.thinking 只剩舊紀錄，沒有耗時資料，統一顯示「思考過程」
  const phase = isThinking ? 'thinking' : 'done'
  const expanded = v3 ? isReasoningExpanded(userExpanded, phase) : isExpanded
  const label = isThinking ? t('ai.thinking')
    : v3 ? t(`record.chat.v3.task.${getReasoningLabel(phase, undefined).key}`) : title
  
  return (
    <div className="w-full space-y-1 mb-2 bg-muted/30 border border-border/50 rounded-lg overflow-hidden">
      {/* 思考卡片 - 单行 */}
      <button
        type="button"
        className={`flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors ${isThinking ? 'bg-muted/50' : 'hover:bg-muted/40'}`}
        onClick={() => v3 ? setUserExpanded(!expanded) : setIsExpanded(!isExpanded)}
        aria-expanded={expanded}
      >
        {isThinking ? (
          <Loader2 className="size-4 animate-spin text-ink flex-shrink-0" />
        ) : (
          <Brain className="size-4 text-ink flex-shrink-0" />
        )}
        <span className="text-sm text-muted-foreground flex-1 truncate min-w-0">
          {label}
        </span>
        <ChevronRight className={`size-4 text-muted-foreground flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {/* 展开的详细内容 */}
      {expanded && (
        <div
          ref={contentRef}
          className="pl-6 pr-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-[250px] overflow-y-auto break-words bg-muted/20"
        >
          {thinkingContent}
        </div>
      )}
    </div>
  )
}
