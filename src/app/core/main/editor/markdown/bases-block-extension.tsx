'use client'

// Fork (Phase 2-3b, 軌道 A)：筆記內的 ```base 區塊，照 mermaid-extension.tsx 的 tokenizer／node view 寫法。
// - 區塊內容是 `.base` 同樣的 YAML（可省略 views，省略時當作單一 table），直接在筆記裡渲染結果。
// - 雙擊或右上「編輯」切回 textarea；⌘／Ctrl＋Enter 或「完成」寫回節點 attr，Esc 取消。
// - 存檔一字不差：節點記住原文 `raw`，內容沒改時 renderMarkdown 直接輸出 raw；改過才重組 fence。
// - 評估在 bases-view.tsx 的 BasesDocument（訂閱索引 revision），進入視口才開始算（useViewportActivation）。

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { parseBase } from '@/lib/bases/format'
import { BasesDocument } from '@/app/core/main/bases/bases-view'
import { useViewportActivation } from './viewport-activation'

export const BASES_BLOCK_NODE_NAME = 'basesBlock'

/** 開頭 ```base（可有尾隨空白）到下一個行首 ``` 為止；內容可為空。 */
const FENCE_RE = /^```base[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m

export interface BasesBlockAttrs {
  /** 區塊內容（不含 fence；結尾換行已去掉） */
  source: string
  /** 讀入時的原文（含 fence），沒改過時原樣輸出 */
  raw: string
}

/** 從原文取出內容；不是合法的 ```base 區塊時回傳 null。 */
export function basesSourceFromRaw(raw: string): string | null {
  const match = FENCE_RE.exec(raw)
  if (!match || match.index !== 0) return null
  return match[1].replace(/\r?\n$/, '')
}

/** renderMarkdown：內容沒改就輸出原文，改過才重組；serializer 會在區塊之間補空行，所以不帶前後換行。 */
export function renderBasesBlockMarkdown(attrs: Partial<BasesBlockAttrs> | undefined): string {
  const source = attrs?.source ?? ''
  const raw = attrs?.raw ?? ''
  if (raw && basesSourceFromRaw(raw) === source) return raw
  return source ? `\`\`\`base\n${source}\n\`\`\`` : '```base\n```'
}

function BasesBlockView({ node, updateAttributes }: ReactNodeViewProps) {
  const t = useTranslations('bases')
  const attrs = node.attrs as Partial<BasesBlockAttrs>
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(attrs.source ?? '')
  const { elementRef, isActive, activate } = useViewportActivation<HTMLDivElement>()

  useEffect(() => {
    if (!isEditing) setDraft(attrs.source ?? '')
  }, [isEditing, attrs.source])

  const parsed = useMemo(() => parseBase(attrs.source ?? ''), [attrs.source])

  const finishEditing = () => {
    if (draft !== (attrs.source ?? '')) updateAttributes({ source: draft })
    activate()
    setIsEditing(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      finishEditing()
    }
    if (event.key === 'Escape') {
      setDraft(attrs.source ?? '')
      setIsEditing(false)
    }
  }

  return (
    <NodeViewWrapper className="notegen-bases-block my-4" data-type="bases-block">
      <div ref={elementRef}>
        {!isEditing && !isActive && (
          <div
            className="min-h-24 cursor-pointer rounded-lg border bg-card p-4"
            onClick={() => activate()}
          >
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!isEditing && isActive && (
          <div
            className="group/bases relative rounded-lg border border-border bg-card p-2"
            onDoubleClick={(event) => { event.preventDefault(); setIsEditing(true) }}
          >
            <BasesDocument base={parsed.base} errors={parsed.errors} compact />
            <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/bases:opacity-100 focus-within:opacity-100">
              <Button
                variant="ghost"
                size="icon-xs"
                title={t('edit')}
                aria-label={t('edit')}
                onClick={(event) => { event.stopPropagation(); setIsEditing(true) }}
              >
                <Pencil />
              </Button>
            </div>
          </div>
        )}

        {isEditing && (
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b bg-muted/50 p-2">
              <span className="text-xs text-muted-foreground">```base</span>
              <div className="flex-1" />
              <Button variant="ghost" size="icon-sm" onClick={finishEditing} title={t('done')} aria-label={t('done')}>
                <Check />
              </Button>
            </div>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={6}
              maxRows={24}
              className="min-h-32 rounded-none border-0 font-mono text-xs shadow-none focus-visible:ring-0"
              spellCheck={false}
              autoFocus
            />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const BasesBlock = Node.create({
  name: BASES_BLOCK_NODE_NAME,
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      source: { default: '' },
      // 原文只用於序列化，不進 HTML
      raw: { default: '', rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="bases-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'bases-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BasesBlockView)
  },

  markdownTokenName: 'bases_block',

  markdownTokenizer: {
    name: 'bases_block',
    level: 'block',
    start: (src: string) => src.indexOf('```base'),
    tokenize: (src: string) => {
      const match = FENCE_RE.exec(src)
      if (!match || match.index !== 0) return undefined
      return {
        type: 'bases_block',
        raw: match[0],
        content: match[1].replace(/\r?\n$/, ''),
        attrs: { raw: match[0] },
        // YAML 對 Markdown 來說是不透明內容
        tokens: [],
      }
    },
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return renderBasesBlockMarkdown(node.attrs as Partial<BasesBlockAttrs> | undefined)
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    return {
      type: BASES_BLOCK_NODE_NAME,
      attrs: { source: token.content ?? '', raw: (token.attrs as { raw?: string } | undefined)?.raw ?? token.raw ?? '' },
    }
  },
})

export default BasesBlock
