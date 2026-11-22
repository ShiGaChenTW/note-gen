'use client'

// Fork（almanac ALMNC-54.17）：V3 桌面版編輯器底部的浮動格式列（參考 HelixNotes）。
// 只在 V3、桌面、所見即所得模式、可編輯時由 tiptap-editor.tsx 掛上；classic 與手機（已有 mobile-writing-toolbar）不變。
// 指令都沿用既有的：格式與區塊用 TipTap 指令、顏色用 ColorMenu（同 bubble menu）、圖片走編輯器的 insertImageAtSelection、
// 連結打開 bubble menu 的連結輸入、附件用斜線指令「檔案」同一套產生連結的方法。按鈕不搶編輯器焦點與選取範圍。
import { useEffect, useReducer, useState, type ComponentType, type MouseEvent, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import {
  Bold, CheckSquare, Code, Code2, Eraser, Heading1, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered,
  Minus, MoreVertical, Paperclip, Quote, Strikethrough, Table2, Underline,
} from 'lucide-react'
import { platform } from '@tauri-apps/plugin-os'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslations } from 'next-intl'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useEditorShortcutStore from '@/stores/editor-shortcut'
import { ColorMenu } from './color-menu'
import { createMarkdownLinksForFilePaths } from './slash-command/suggestion'
import {
  BOTTOM_TOOLBAR_GROUPS, BOTTOM_TOOLBAR_MORE, activeToolbarItems, formatShortcutLabel,
  type BottomToolbarItem, type BottomToolbarItemId,
} from './bottom-format-toolbar-items'

const OWNER = 'bottom-format-toolbar'

const ICONS: Partial<Record<BottomToolbarItemId, ComponentType<{ className?: string }>>> = {
  bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough, code: Code,
  heading1: Heading1, heading2: Heading2, heading3: Heading3,
  bulletList: List, table: Table2, image: ImagePlus, link: Link2, attachment: Paperclip,
  orderedList: ListOrdered, taskList: CheckSquare, blockquote: Quote, codeBlock: Code2, horizontalRule: Minus, clearFormatting: Eraser,
}

const BUTTON = 'grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-ink outline-none transition-colors duration-100 hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4'

/** 不讓按下按鈕時編輯器失焦、選取範圍消失（同 bubble menu 的做法）。 */
const keepEditorFocus = (event: MouseEvent) => event.preventDefault()

function useIsMac() {
  const [mac, setMac] = useState(true)
  useEffect(() => {
    try { setMac(platform() === 'macos') } catch { setMac(typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)) }
  }, [])
  return mac
}

/** 編輯器每次交易（打字、移動游標）都重畫，亮起狀態才會跟著變。 */
function useEditorRevision(editor: Editor) {
  const [, bump] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    editor.on('transaction', bump)
    editor.on('selectionUpdate', bump)
    return () => {
      editor.off('transaction', bump)
      editor.off('selectionUpdate', bump)
    }
  }, [editor])
}

function ToolbarButton({ label, active, onClick, children }: { label: string, active?: boolean, onClick: () => void, children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active === undefined ? undefined : active}
          onMouseDown={keepEditorFocus}
          onClick={onClick}
          className={cn(BUTTON, active && 'bg-active text-ink')}
        >
          {children}
        </button>
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
  useEditorRevision(editor)
  const t = useTranslations('settings.shortcuts.editorShortcuts.commands')
  const tEditor = useTranslations('editor')
  const tToolbar = useTranslations('editor.bottomToolbar')
  const shortcuts = useEditorShortcutStore(state => state.shortcuts)
  const mac = useIsMac()
  const active = activeToolbarItems((name, attrs) => editor.isActive(name, attrs))

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
        role="toolbar"
        aria-label={tToolbar('label')}
        data-editor-bubble-menu-owner={OWNER}
        data-testid="bottom-format-toolbar"
        onMouseDown={keepEditorFocus}
        className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-panel px-1.5 py-1 shadow-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {BOTTOM_TOOLBAR_GROUPS.map((group, index) => (
          <div key={group[0].id} className="flex shrink-0 items-center gap-0.5">
            {index > 0 && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />}
            {group.map(item => {
              if (item.id === 'highlight' || item.id === 'textColor') {
                return (
                  <span key={item.id} className="shrink-0 [&_button]:size-7 [&_button]:rounded-full [&_button]:text-muted-ink [&_button:hover]:text-ink [&_svg]:size-4">
                    <ColorMenu editor={editor} owner={OWNER} highlight={item.id === 'highlight'} />
                  </span>
                )
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
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={tToolbar('more')} onMouseDown={keepEditorFocus} className={BUTTON}>
                  <MoreVertical />
                </button>
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
