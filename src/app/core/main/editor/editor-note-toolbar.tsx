'use client'

// Fork（almanac）：V3 編輯區右上角的筆記工具列（原本只有復原／重做）。V3 沒有分頁列、一次只開一篇，classic 不掛這個元件。
// 由左到右四組：[返回 前進] | [尋找 標籤 置頂 收藏] | [大綱 版本歷史 筆記資訊 命令面板] | [復原 重做]。
// - 返回／前進：editor-layout 既有的瀏覽歷史（⌘[／⌘]、Alt+←／→ 同一套），由 props 傳入。
// - 尋找：送 editor-search-trigger（同 ⌘F 與狀態列）。大綱：使用中編輯器登記的 toggleOutline（同狀態列「大綱」）。
// - 版本歷史：送 editor-open-version-history，打開狀態列上同一個版本歷史面板。命令面板：同側欄「搜尋或下指令」。
// - 標籤：讀寫 frontmatter 的 tags（寫法同屬性卡片，只改 tags 那一行）。置頂／收藏：stores/note-marks（每個工作區一份）。
// 筆記專屬的按鈕只給 .md 筆記；編輯區窄於 720px 時第三、四組收進「⋯」。圖示刻意不用參考稿那套（箭頭、放大鏡、標籤、圖釘、星號⋯⋯）。
// ALMNC-56.2：按鈕與分隔線改用 components/v3/toolbar（和底部格式列同一套，A11 roving tabindex、V07 外觀）；列本身不帶底色。
// 命令面板的 ⌘K 在編輯器裡是「插入連結」（anywhere-service 不攔截），提示註明「編輯器外」（A09）。
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import {
  ArrowLeft, ArrowRight, ArrowUpToLine, Ellipsis, FileText, Hash, Heart, History, ListTree, Redo2, SquareSlash,
  TextSearch, Undo2, X,
} from 'lucide-react'
import { platform } from '@tauri-apps/plugin-os'
import { useEditorState, type Editor } from '@tiptap/react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ToolbarDivider, ToolbarIconButton, useRovingToolbar } from '@/components/v3/toolbar'
import { useAnywhereStore } from '@/lib/anywhere/store'
import { getEditorStatistics } from '@/lib/editor-statistics'
import emitter from '@/lib/emitter'
import type { PropertyType } from '@/lib/markdown/frontmatter-edit'
import { noteFolder } from '@/lib/note-list/note-list'
import { hasMarkedPath, noteMarksWorkspaceKey } from '@/lib/note-toolbar/note-marks'
import { addTag, planTagsWrite, readFrontmatterTags, removeTagAt } from '@/lib/note-toolbar/note-tags'
import { isCompactToolbar, noteToolbarScope } from '@/lib/note-toolbar/toolbar-layout'
import { loadObsidianPropertyTypes } from '@/lib/obsidian-types'
import { getFilePathOptions } from '@/lib/workspace'
import { useActiveNoteEditorStore } from '@/stores/active-note-editor'
import useEditorShortcutStore from '@/stores/editor-shortcut'
import useNoteMarksStore, { selectWorkspaceMarks, type NoteMarkKind } from '@/stores/note-marks'
import useSettingStore from '@/stores/setting'
import { formatShortcutLabel } from './markdown/bottom-format-toolbar-items'
import { WIKI_METADATA_NODE_NAME } from './markdown/wiki-metadata-tokenizer'
import { useEditorUndoRedo } from './editor-undo-redo'
import type { TabInfo } from './tab-bar'

function useIsMac() {
  const [mac, setMac] = useState(false)
  useEffect(() => {
    try { setMac(platform() === 'macos') } catch { setMac(false) }
  }, [])
  return mac
}

/** 量工具列所在編輯區（父元素）的寬度，決定要不要收成「⋯」。 */
function useContainerWidth(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const container = ref.current?.parentElement
    if (!enabled || !container) return
    setWidth(container.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? container.clientWidth))
    observer.observe(container)
    return () => observer.disconnect()
  }, [enabled, ref])
  return width
}

function withShortcut(label: string, shortcut: string) {
  return shortcut ? `${label} (${shortcut})` : label
}

function ToolbarButton({ label, icon, onClick, disabled, pressed, buttonRef, wrap }: {
  label: string
  icon: ReactNode
  onClick?: () => void
  disabled?: boolean
  pressed?: boolean
  buttonRef?: Ref<HTMLButtonElement>
  /** 把按鈕包進 PopoverTrigger／DropdownMenuTrigger 等 asChild 元件 */
  wrap?: (button: ReactNode) => ReactNode
}) {
  const button = (
    <ToolbarIconButton ref={buttonRef} aria-label={label} pressed={pressed} disabled={disabled} onClick={onClick}>
      {icon}
    </ToolbarIconButton>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{wrap ? wrap(button) : button}</TooltipTrigger>
      <TooltipContent side="bottom"><p>{label}</p></TooltipContent>
    </Tooltip>
  )
}

interface EditorNoteToolbarProps {
  activeTab?: TabInfo
  isActiveGroup: boolean
  canGoBack: boolean
  canGoForward: boolean
  onNavigate: (direction: 'back' | 'forward') => void
}

export function EditorNoteToolbar({ activeTab, isActiveGroup, canGoBack, canGoForward, onNavigate }: EditorNoteToolbarProps) {
  const t = useTranslations('editor.noteToolbar')
  const tTab = useTranslations('tabContext')
  const tOutline = useTranslations('editor.outline')
  const tHistory = useTranslations('versionHistory')
  const showEditorUndoRedo = useSettingStore(state => state.showEditorUndoRedo)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const outlineShortcut = useEditorShortcutStore(state => state.shortcuts.find(item => item.id === 'toggleOutline')?.value ?? '')
  const mac = useIsMac()
  const rootRef = useRef<HTMLDivElement>(null)
  const openInfoAfterMenuRef = useRef(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const roving = useRovingToolbar(rootRef)

  const scope = noteToolbarScope(activeTab, isActiveGroup)
  const isNote = scope === 'note'
  const notePath = isNote && activeTab ? activeTab.path : ''
  const compact = isCompactToolbar(useContainerWidth(rootRef, scope !== 'hidden'))
  const { canUndo, canRedo, run: runUndoRedo } = useEditorUndoRedo(activeTab, isActiveGroup)

  // 使用中編輯器登記的實例；換篇時路徑對不上就先當作還沒準備好。
  const activeEditor = useActiveNoteEditorStore(state => state.active)
  const noteEditor = activeEditor && notePath && activeEditor.path === notePath ? activeEditor : null

  const workspaceKey = noteMarksWorkspaceKey(workspacePath)
  const pinnedList = useNoteMarksStore(state => selectWorkspaceMarks(state, 'pinned', workspaceKey))
  const favoriteList = useNoteMarksStore(state => selectWorkspaceMarks(state, 'favorites', workspaceKey))
  useEffect(() => { void useNoteMarksStore.getState().load() }, [])
  const pinned = Boolean(notePath) && hasMarkedPath(pinnedList, notePath)
  const favorite = Boolean(notePath) && hasMarkedPath(favoriteList, notePath)

  useEffect(() => { setInfoOpen(false) }, [notePath])

  if (scope === 'hidden') return null

  const mod = mac ? '⌘' : 'Ctrl+'
  const labels = {
    back: withShortcut(t('back'), mac ? '⌘[' : 'Alt+←'),
    forward: withShortcut(t('forward'), mac ? '⌘]' : 'Alt+→'),
    find: withShortcut(t('find'), `${mod}F`),
    pin: pinned ? t('unpin') : t('pin'),
    favorite: favorite ? t('unfavorite') : t('favorite'),
    outline: withShortcut(noteEditor?.outlineOpen ? tOutline('close') : tOutline('open'), formatShortcutLabel(outlineShortcut, mac)),
    history: tHistory('title'),
    info: t('info'),
    command: withShortcut(t('command'), t('outsideEditorShortcut', { shortcut: `${mod}K` })),
    undo: `${tTab('undo')} (${mod}Z)`,
    redo: `${tTab('redo')} (${mod}Shift+Z)`,
  }

  const toggleMark = (kind: NoteMarkKind) => {
    if (!notePath) return
    void useNoteMarksStore.getState().toggle(kind, workspaceKey, notePath).catch(error => {
      console.error('Failed to save note marks:', error)
    })
  }
  const openPalette = () => useAnywhereStore.getState().setPaletteOpen(true)
  const openHistory = () => emitter.emit('editor-open-version-history')
  const toggleOutline = () => noteEditor?.toggleOutline()

  return (
    <TooltipProvider>
      <Popover open={infoOpen} onOpenChange={setInfoOpen}>
        <div
          ref={rootRef}
          role="toolbar"
          aria-label={t('label')}
          aria-orientation="horizontal"
          className="absolute top-2 right-3 z-20 flex items-center gap-0.5 text-muted-ink"
          data-testid="editor-note-toolbar"
          {...roving}
        >
          <ToolbarButton label={labels.back} icon={<ArrowLeft />} disabled={!canGoBack} onClick={() => onNavigate('back')} />
          <ToolbarButton label={labels.forward} icon={<ArrowRight />} disabled={!canGoForward} onClick={() => onNavigate('forward')} />

          {isNote ? (
            <>
              <ToolbarDivider />
              <ToolbarButton label={labels.find} icon={<TextSearch />} onClick={() => emitter.emit('editor-search-trigger')} />
              <TagsButton editor={noteEditor?.editor ?? null} label={t('tags')} />
              <ToolbarButton label={labels.pin} icon={<ArrowUpToLine />} pressed={pinned} onClick={() => toggleMark('pinned')} />
              <ToolbarButton label={labels.favorite} icon={<Heart />} pressed={favorite} onClick={() => toggleMark('favorites')} />
            </>
          ) : null}

          <ToolbarDivider />
          {compact ? (
            <DropdownMenu>
              <ToolbarButton
                label={t('more')}
                icon={<Ellipsis />}
                wrap={button => <PopoverAnchor asChild><DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger></PopoverAnchor>}
              />
              <DropdownMenuContent
                align="end"
                collisionPadding={8}
                onCloseAutoFocus={event => {
                  // 從選單開「筆記資訊」：等選單收完、焦點歸位後再開，否則焦點回到「⋯」會把剛開的資訊框關掉。
                  if (!openInfoAfterMenuRef.current) return
                  openInfoAfterMenuRef.current = false
                  event.preventDefault()
                  setInfoOpen(true)
                }}
              >
                {isNote ? (
                  <>
                    <DropdownMenuCheckboxItem checked={Boolean(noteEditor?.outlineOpen)} disabled={!noteEditor} onSelect={toggleOutline}>
                      <ListTree />{tOutline('title')}
                      {formatShortcutLabel(outlineShortcut, mac) ? <DropdownMenuShortcut>{formatShortcutLabel(outlineShortcut, mac)}</DropdownMenuShortcut> : null}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuItem onSelect={openHistory}><History />{labels.history}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { openInfoAfterMenuRef.current = true }}><FileText />{labels.info}</DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuItem onSelect={openPalette}><SquareSlash />{t('command')}<DropdownMenuShortcut>{t('outsideEditorShortcut', { shortcut: `${mod}K` })}</DropdownMenuShortcut></DropdownMenuItem>
                {showEditorUndoRedo ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={!canUndo} onSelect={() => runUndoRedo(false)}><Undo2 />{tTab('undo')}<DropdownMenuShortcut>{`${mod}Z`}</DropdownMenuShortcut></DropdownMenuItem>
                    <DropdownMenuItem disabled={!canRedo} onSelect={() => runUndoRedo(true)}><Redo2 />{tTab('redo')}<DropdownMenuShortcut>{`${mod}Shift+Z`}</DropdownMenuShortcut></DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {isNote ? (
                <>
                  <ToolbarButton label={labels.outline} icon={<ListTree />} pressed={Boolean(noteEditor?.outlineOpen)} disabled={!noteEditor} onClick={toggleOutline} />
                  <ToolbarButton label={labels.history} icon={<History />} onClick={openHistory} />
                  <ToolbarButton label={labels.info} icon={<FileText />} wrap={button => <PopoverTrigger asChild>{button}</PopoverTrigger>} />
                </>
              ) : null}
              <ToolbarButton label={labels.command} icon={<SquareSlash />} onClick={openPalette} />
              {showEditorUndoRedo ? (
                <>
                  <ToolbarDivider />
                  <ToolbarButton label={labels.undo} icon={<Undo2 />} disabled={!canUndo} onClick={() => runUndoRedo(false)} />
                  <ToolbarButton label={labels.redo} icon={<Redo2 />} disabled={!canRedo} onClick={() => runUndoRedo(true)} />
                </>
              ) : null}
            </>
          )}
        </div>
        {isNote && infoOpen ? <NoteInfoContent path={notePath} editor={noteEditor?.editor ?? null} /> : null}
      </Popover>
    </TooltipProvider>
  )
}

/** frontmatter 節點的原文；沒有 frontmatter 時回傳 null。 */
function frontmatterRawOf(editor: Editor | null): string | null {
  const first = editor?.state.doc.firstChild
  return first?.type.name === 'frontmatter' ? String(first.attrs.raw ?? '') : null
}

function TagsButton({ editor, label }: { editor: Editor | null, label: string }) {
  const t = useTranslations('editor.noteToolbar')
  const tProperties = useTranslations('properties')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [types, setTypes] = useState<Record<string, PropertyType>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const state = useEditorState({
    editor,
    selector: ctx => ({
      raw: frontmatterRawOf(ctx.editor),
      editable: Boolean(ctx.editor?.isEditable),
      // LLM Wiki 筆記開頭是唯讀的 wiki metadata，不另外插一段 frontmatter。
      wiki: ctx.editor?.state.doc.firstChild?.type.name === WIKI_METADATA_NODE_NAME,
    }),
  })
  const raw = state?.raw ?? null
  const { tags, editable: tagsEditable } = useMemo(() => readFrontmatterTags(raw, types), [raw, types])
  const canEdit = Boolean(editor) && Boolean(state?.editable) && tagsEditable && !state?.wiki

  useEffect(() => {
    if (!open) return
    let current = true
    void loadObsidianPropertyTypes().then(value => { if (current) setTypes(value) }).catch(() => undefined)
    return () => { current = false }
  }, [open])
  useEffect(() => { if (!open) setDraft('') }, [open])

  const write = (next: string[]) => {
    if (!editor || editor.isDestroyed) return false
    try {
      const currentRaw = frontmatterRawOf(editor)
      const plan = planTagsWrite(currentRaw, next, types)
      if (plan.kind === 'update') {
        const first = editor.state.doc.firstChild
        if (!first) return false
        editor.chain().command(({ tr }) => {
          tr.setNodeMarkup(0, undefined, { ...first.attrs, raw: plan.raw })
          return true
        }).run()
      } else if (plan.kind === 'insert') {
        editor.chain().insertContentAt(0, { type: 'frontmatter', attrs: { raw: plan.raw } }).run()
      }
      return true
    } catch (error) {
      toast.error(tProperties('saveFailed'), { description: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  const commitDraft = () => {
    const next = addTag(tags, draft)
    if (next.length === tags.length) { setDraft(''); return }
    if (write(next)) setDraft('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ToolbarButton
        label={label}
        icon={<Hash />}
        disabled={!editor}
        wrap={button => <PopoverTrigger asChild>{button}</PopoverTrigger>}
      />
      <PopoverContent
        align="end"
        className="w-64 gap-2"
        onOpenAutoFocus={event => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <p className="text-xs font-medium text-muted-ink">{label}</p>
        {tags.length ? (
          <ul className="flex flex-wrap gap-1" aria-label={label}>
            {tags.map((tag, index) => (
              <li key={`${index}:${tag}`} className="inline-flex max-w-full items-center gap-1 rounded bg-hover px-2 py-0.5 text-xs font-medium text-ink">
                <span className="break-all">#{tag}</span>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={t('removeTag', { tag })}
                    className="-my-0.5 -mr-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-ink outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60"
                    onClick={() => { write(removeTagAt(tags, index)) }}
                  ><X className="size-3" aria-hidden /></button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-faint">{t('noTags')}</p>
        )}
        {canEdit ? (
          <Input
            ref={inputRef}
            value={draft}
            placeholder={t('addTag')}
            aria-label={t('addTag')}
            className="h-7 text-sm"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              commitDraft()
            }}
          />
        ) : editor && !tagsEditable ? (
          <p className="text-xs text-muted-ink">{t('tagsReadOnly')}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

interface FileTimes { created: number | null, modified: number | null }

function NoteInfoContent({ path, editor }: { path: string, editor: Editor | null }) {
  const t = useTranslations('editor.noteToolbar')
  const tVault = useTranslations('sidebarV3')
  const tStats = useTranslations('settings.editor.stats')
  const locale = useLocale()
  const [times, setTimes] = useState<FileTimes | null>(null)

  useEffect(() => {
    let current = true
    setTimes(null)
    void (async () => {
      try {
        const [{ stat }, options] = await Promise.all([import('@tauri-apps/plugin-fs'), getFilePathOptions(path)])
        const info = options.baseDir ? await stat(options.path, { baseDir: options.baseDir }) : await stat(options.path)
        if (current) setTimes({ created: info.birthtime?.getTime() ?? null, modified: info.mtime?.getTime() ?? null })
      } catch {
        if (current) setTimes({ created: null, modified: null })
      }
    })()
    return () => { current = false }
  }, [path])

  const statistics = getEditorStatistics(editor && !editor.isDestroyed ? editor.state.doc.textContent : '')
  const formatTime = (value: number | null | undefined) => (
    value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value) : '—'
  )
  const fileName = path.replace(/\\/g, '/').split('/').pop() ?? path
  const folder = noteFolder(path)
  const rows: Array<[string, string]> = [
    [t('infoFileName'), fileName],
    [t('infoFolder'), folder || tVault('vault')],
    [t('infoCreated'), times ? formatTime(times.created) : '…'],
    [t('infoModified'), times ? formatTime(times.modified) : '…'],
    [t('infoLength'), `${tStats('characters', { count: statistics.characters })} · ${tStats('readingTime', { count: statistics.readingMinutes })}`],
  ]

  return (
    <PopoverContent align="end" className="w-72 gap-2">
      <p className="text-xs font-medium text-muted-ink">{t('info')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-ink">{label}</dt>
            <dd className="min-w-0 break-all text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </PopoverContent>
  )
}
