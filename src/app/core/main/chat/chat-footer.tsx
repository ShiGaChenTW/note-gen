"use client"

import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"
import { PROMPT_LIBRARY_ENABLED } from "@/lib/prompt-library/feature"
import { cn } from '@/lib/utils'
import { StatusBarItem } from '../status-bar-order'

export function ChatFooter({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={cn(
      'flex h-6 min-w-0 items-center gap-2 overflow-hidden bg-background text-xs v3:text-ui-compact text-muted-foreground',
      embedded ? 'contents' : 'w-full justify-between border-t border-border px-1',
    )}>
      {embedded ? <>
        <StatusBarItem id="system:model" rank={90}><ModelSelect display="status" /></StatusBarItem>
        {/* Fork（almanac ALMNC-83.3）：對話角色跟著提示詞開關關閉 */}
        {PROMPT_LIBRARY_ENABLED && <StatusBarItem id="system:prompt" rank={91}><PromptSelect display="status" /></StatusBarItem>}
      </> : <>
        <ModelSelect display="status" />
        {PROMPT_LIBRARY_ENABLED && <PromptSelect display="status" />}
      </>}
    </div>
  )
}
