'use client'

// Fork（almanac ALMNC-63）：Live Preview（Split）的右側預覽。只讀，跟著左側原始碼即時更新，
// 捲動依左側的捲動比例同步。
import { memo, useDeferredValue, useEffect, useRef } from 'react'

import { StreamdownRenderer } from '@/components/markdown/streamdown-renderer'
import { cn } from '@/lib/utils'

interface MarkdownSplitPreviewProps {
  markdown: string
  /** 左側原始碼的捲動比例（0–1）；undefined 時不同步 */
  scrollRatio?: number
  ariaLabel: string
  className?: string
}

const PreviewBody = memo(function PreviewBody({ markdown }: { markdown: string }) {
  return <StreamdownRenderer markdown={markdown} interactiveCodeBlocks={false} />
})

export function MarkdownSplitPreview({ markdown, scrollRatio, ariaLabel, className }: MarkdownSplitPreviewProps) {
  const deferredMarkdown = useDeferredValue(markdown)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (!element || scrollRatio === undefined) return
    const max = element.scrollHeight - element.clientHeight
    if (max > 0) element.scrollTop = scrollRatio * max
  }, [scrollRatio, deferredMarkdown])

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={ariaLabel}
      data-editor-split-preview
      className={cn('h-full min-h-0 overflow-y-auto px-6 py-4', className)}
    >
      <PreviewBody markdown={deferredMarkdown} />
    </div>
  )
}
