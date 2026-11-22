'use client'

// Fork（almanac ALMNC-54.17）：V3 桌面版編輯器底部的浮動格式列（參考 HelixNotes）。
// 只在 V3、桌面、所見即所得模式、可編輯時由 tiptap-editor.tsx 掛上；classic 與手機（已有 mobile-writing-toolbar）不變。
// 指令都沿用既有的：格式與區塊用 TipTap 指令、顏色用 ColorMenu（同 bubble menu）、圖片走編輯器的 insertImageAtSelection、
// 連結打開 bubble menu 的連結輸入、附件用斜線指令「檔案」同一套產生連結的方法。按鈕不搶編輯器焦點與選取範圍。
// ALMNC-56.2：
// - A03：列開著時給 ProseMirror scrollThreshold／scrollMargin（下方 64 px），打字、換行時游標行一進到列的範圍就捲到列的上方；
//   style.css 另給捲動容器 scroll-padding-bottom。
// - P04：亮起狀態用 useEditorState 加比對函式取得，打字時狀態不變就不重繪整列。
// - A11、V07：按鈕、分隔線與 roving tabindex 用 components/v3/toolbar（和右上筆記工具列同一套）。
// - V10：列的陰影用 shadow-float token。
import { useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  Bold, CheckSquare, Code, Code2, Eraser, Heading1, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered,
  Minus, MoreVertical, Paperclip, Quote, Strikethrough, Table2, Underline,
} from 'lucide-react'
import { platform } from '@tauri-apps/plugin-os'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslations } from 'next-intl'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ToolbarDivider, ToolbarIconButton, useRovingToolbar } from '@/components/v3/toolbar'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useEditorShortcutStore from '@/stores/editor-shortcut'
import { ColorMenu } from './color-menu'
import { createMarkdownLinksForFilePaths } from './slash-command/suggestion'
import {
  BOTTOM_TOOLBAR_GROUPS, BOTTOM_TOOLBAR_MORE, bottomToolbarState, formatShortcutLabel, sameBottomToolbarState,
  type BottomToolbarItem, type BottomToolbarItemId,
} from './bottom-format-toolbar-items'

const OWNER = 'bottom-format-toolbar'

const ICONS: Partial<Record<BottomToolbarItemId, ComponentType<{ className?: string }>>> = {
  bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough, code: Code,
  heading1: Heading1, heading2: Heading2, heading3: Heading3,
  bulletList: List, table: Table2, image: ImagePlus, link: Link2, attachment: Paperclip,
  orderedList: ListOrdered, taskList: CheckSquare, blockquote: Quote, codeBlock: Code2, horizontalRule: Minus, clearFormatting: Eraser,
}

/**
 * 列顯示時給 ProseMirror 的捲動設定（A03）。列底距 16 px＋列高 36 px＝52 px，下方讓出 64 px：
 * - scrollThreshold：游標行進到離底 64 px 內就捲動（預設 0，要碰到底才捲，列底下那段會被蓋住）。
 * - scrollMargin：捲動後游標行停在離底 64 px 處，也就是列上方約 12 px。
 * 其他三邊維持 ProseMirror 預設（threshold 0、margin 5 px）。
 */
export const BOTTOM_TOOLBAR_SCROLL_THRESHOLD = { top: 0, right: 0, bottom: 64, left: 0 }
export const BOTTOM_TOOLBAR_SCROLL_MARGIN = { top: 5, right: 5, bottom: 64, left: 5 }

/** 不讓按下按鈕時編輯器失焦、選取範圍消失（同 bubble menu 的做法）。 */
const keepEditorFocus = (event: MouseEvent) => event.preventDefault()

function useIsMac() {
  const [mac, setMac] = useState(true)
  useEffect(() => {
    try { setMac(platform() === 'macos') } catch { setMac(typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)) }
  }, [])
  return mac
}

/** 列開著時把捲動設定交給編輯器，收起或換編輯器時還原（A03）。 */
function useToolbarScrollMargin(editor: Editor) {
  useEffect(() => {
    if (editor.isDestroyed) return
    const { scrollThreshold, scrollMargin } = editor.options.editorProps ?? {}
    editor.setOptions({
      editorProps: { ...editor.options.editorProps, scrollThreshold: BOTTOM_TOOLBAR_SCROLL_THRESHOLD, scrollMargin: BOTTOM_TOOLBAR_SCROLL_MARGIN },
    })
    return () => {
      if (editor.isDestroyed) return
      editor.setOptions({ editorProps: { ...editor.options.editorProps, scrollThreshold, scrollMargin } })
    }
  }, [editor])
}

function ToolbarButton({ label, active, onClick, children }: { label: string, active?: boolean, onClick: () => void, children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolbarIconButton aria-label={label} pressed={active} onMouseDown={keepEditorFocus} onClick={onClick}>
          {children}
        </ToolbarIconButton>
      </TooltipTrigger>
      <TooltipContent side="top"><p>{label}</p></TooltipContent>
    </Tooltip>
  )
}

export function BottomFormatToolbar({ editor, onInsertImage, onOpenLink }: {
  editor: Editor
  onInsertImage: () => void
  onOpenLink: () => void
}) {
  useToolbarScrollMargin(editor)
  const rootRef = useRef<HTMLDivElement>(null)
  const roving = useRovingToolbar(rootRef)
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: current }) => bottomToolbarState(
      (name, attrs) => current.isActive(name, attrs),
      mark => current.getAttributes(mark).color,
    ),
    equalityFn: sameBottomToolbarState,
  })
  const active = useMemo(() => new Set(toolbarState.active), [toolbarState])
  const t = useTranslations('settings.shortcuts.editorShortcuts.commands')
  const tEditor = useTranslations('editor')
  const tToolbar = useTranslations('editor.bottomToolbar')
  const shortcuts = useEditorShortcutStore(state => state.shortcuts)
  const mac = useIsMac()

  const shortcutOf = (item: BottomToolbarItem) => {
    if (!item.shortcut) return ''
    return formatShortcutLabel(shortcuts.find(entry => entry.id === item.shortcut)?.value ?? '', mac)
  }
  const nameOf = (item: BottomToolbarItem) => {
    if (item.id === 'attachment') return tEditor('slashCommand.items.file')
    if (item.id === 'clearFormatting') return tEditor('blockHandle.clearFormatting')
    return item.shortcut ? t(`${item.shortcut}.title`) : item.id
  }
  const labelOf = (item: BottomToolbarItem) => {
    const shortcut = shortcutOf(item)
    return shortcut ? `${nameOf(item)} (${shortcut})` : nameOf(item)
  }

  const insertAttachment = async () => {
    const insertAt = editor.state.selection.from
    const doc = editor.state.doc
    try {
      const selected = await open({ multiple: true, directory: false })
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
      if (paths.length === 0 || editor.isDestroyed) return
      const links = await createMarkdownLinksForFilePaths(paths, useArticleStore.getState().activeFilePath)
      if (links.length === 0 || editor.isDestroyed) return
      // 選檔期間文件被改過就插在目前游標處，避免位置錯開
      const position = editor.state.doc === doc ? insertAt : editor.state.selection.from
      editor.chain().focus().insertContentAt(position, links.join('\n'), { contentType: 'markdown' }).run()
    } catch (error) {
      toast({
        title: tEditor('slashCommand.fileInsert.failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      })
    }
  }

  const openLink = () => {
    const { empty, from } = editor.state.selection
    if (empty) {
      // 沒選文字時先插入「連結」兩字並選起來，連結輸入框才有對象
      const text = tEditor('bubbleMenu.link')
      editor.chain().focus().insertContent(text).setTextSelection({ from, to: from + text.length }).run()
    }
    onOpenLink()
  }

  const run = (id: BottomToolbarItemId) => {
    const chain = editor.chain().focus()
    switch (id) {
      case 'bold': chain.toggleBold().run(); return
      case 'italic': chain.toggleItalic().run(); return
      case 'underline': chain.toggleUnderline().run(); return
      case 'strike': chain.toggleStrike().run(); return
      case 'code': chain.toggleCode().run(); return
      case 'heading1': chain.toggleHeading({ level: 1 }).run(); return
      case 'heading2': chain.toggleHeading({ level: 2 }).run(); return
      case 'heading3': chain.toggleHeading({ level: 3 }).run(); return
      case 'bulletList': chain.toggleBulletList().run(); return
      case 'orderedList': chain.toggleOrderedList().run(); return
      case 'taskList': chain.toggleTaskList().run(); return
      case 'blockquote': chain.toggleBlockquote().run(); return
      case 'codeBlock': chain.toggleCodeBlock().run(); return
      case 'horizontalRule': chain.setHorizontalRule().run(); return
      case 'clearFormatting': chain.unsetAllMarks().clearNodes().run(); return
      case 'table': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); return
      case 'image': onInsertImage(); return
      case 'link': openLink(); return
      case 'attachment': void insertAttachment(); return
      default: return
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={rootRef}
        role="toolbar"
        aria-label={tToolbar('label')}
        aria-orientation="horizontal"
        data-editor-bubble-menu-owner={OWNER}
        data-testid="bottom-format-toolbar"
        onMouseDown={keepEditorFocus}
        {...roving}
        className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-[10px] bg-panel p-1 shadow-float [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {BOTTOM_TOOLBAR_GROUPS.map((group, index) => (
          <div key={group[0].id} className="flex shrink-0 items-center gap-0.5">
            {index > 0 && <ToolbarDivider />}
            {group.map(item => {
              if (item.id === 'highlight' || item.id === 'textColor') {
                return <ColorMenu key={item.id} editor={editor} owner={OWNER} highlight={item.id === 'highlight'} toolbar />
              }
              const Icon = ICONS[item.id]
              return (
                <ToolbarButton key={item.id} label={labelOf(item)} active={item.active ? active.has(item.id) : undefined} onClick={() => run(item.id)}>
                  {Icon && <Icon />}
                </ToolbarButton>
              )
            })}
          </div>
        ))}
        <ToolbarDivider />
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ToolbarIconButton aria-label={tToolbar('more')} onMouseDown={keepEditorFocus}>
                  <MoreVertical />
                </ToolbarIconButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top"><p>{tToolbar('more')}</p></TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            side="top"
            align="end"
            collisionPadding={8}
            data-editor-bubble-menu-owner={OWNER}
            onCloseAutoFocus={event => {
              event.preventDefault()
              if (!editor.isDestroyed) editor.view.focus()
            }}
          >
            {BOTTOM_TOOLBAR_MORE.map(item => {
              const Icon = ICONS[item.id]
              const shortcut = shortcutOf(item)
              return (
                <DropdownMenuItem key={item.id} onSelect={() => run(item.id)} className={cn(active.has(item.id) && 'bg-active')}>
                  {Icon && <Icon />}
                  {nameOf(item)}
                  {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  )
}
