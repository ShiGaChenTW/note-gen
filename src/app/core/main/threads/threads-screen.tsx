'use client'

// Fork（almanac ALMNC-14）：V3 對話頁。左邊是對話串列表（可依專案分組或依時間），右邊就是既有的對話面板（輸入框、審批、修改比對都沒動）。
// 做法同收集頁：蓋在編輯器與右側欄上方、留著左側欄；只在新介面（v3）顯示。
// 對話面板只有一份（chat-dock.tsx 把右側欄那份搬進來），所以這裡不重寫任何對話內部。
import { Segmented } from '@/components/v3/segmented'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown, FolderInput, Hash, MessageSquarePlus, MessagesSquare, Pin, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { V3_BUTTON_SHAPE } from '@/components/v3/button-shape'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useUiV3 } from '@/lib/fork-ui'
import { groupThreads, listProjects, projectOf, threadKey, type ThreadConversation, type ThreadGroupMode } from '@/lib/threads/projects'
import { cn } from '@/lib/utils'
import useChatStore from '@/stores/chat'
import useCollectStore from '@/stores/collect'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import usePromptLibraryStore from '@/stores/prompt-library'
import useThreadsStore from '@/stores/threads'
import { useSidebarStore } from '@/stores/sidebar'
import { Count } from '@/components/v3/count'
import { EmptyState } from '@/components/v3/empty-state'
import { SectionLabel } from '@/components/v3/section-label'
import { PageHeader, PageSurface } from '../page-ui'
import { PendingProposalsNote, ThreadTagPrefix } from './thread-status'
import { usePendingCounts } from '@/lib/decide/use-decisions'
import { tagOf, type ThreadTag } from '@/lib/threads/tags'

function relativeTime(ms: number, now: number, t: (key: string, values?: Record<string, number>) => string): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60000))
  if (minutes < 1) return t('time.now')
  if (minutes < 60) return t('time.minutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.hours', { count: hours })
  return t('time.days', { count: Math.round(hours / 24) })
}

function ThreadRow({ thread, tag, pending, project, projects, current, now, onOpen, onMove }: {
  thread: ThreadConversation
  /** Fork（almanac ALMNC-54.4）：名稱前的標籤。 */
  tag: ThreadTag
  /** Fork（almanac ALMNC-54.5）：還有幾則提案待決定。 */
  pending: number
  project: string
  projects: string[]
  current: boolean
  now: number
  onOpen: () => void
  onMove: (project: string | null) => void
}) {
  const t = useTranslations('threads')
  return (
    <div
      className={cn('group/row relative flex items-center rounded-(--r-kbd) hover:bg-hover', current && 'bg-active')}
      data-thread-id={thread.id}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={current ? 'true' : undefined}
        className="grid min-w-0 flex-1 grid-cols-[1fr_auto] gap-x-2 rounded-(--r-kbd) px-2.5 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-ui-compact font-medium text-ink">
          {thread.isPinned && <Pin aria-label={t('pinned')} className="size-3 shrink-0 text-muted-ink" />}
          <span className="truncate"><ThreadTagPrefix tag={tag} />{thread.title || t('untitled')}</span>
        </span>
        <span className="text-xs text-muted-ink tabular-nums">{relativeTime(thread.updatedAt, now, t)}</span>
        <span className="col-span-2 truncate text-ui-compact text-muted-ink">
          {project ? `${project} · ` : ''}<span className="text-xs tabular-nums">{t('messageCount', { count: thread.messageCount })}</span>
          {pending > 0 && <> · <PendingProposalsNote count={pending} className="text-ink tabular-nums" /></>}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('moveToProject')}
            title={t('moveToProject')}
            className="mr-1 shrink-0 text-muted-ink opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
          >
            <FolderInput aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-ui-compact text-muted-ink">{t('moveToProject')}</DropdownMenuLabel>
          {projects.map(name => (
            <DropdownMenuItem key={name} onSelect={() => onMove(name)}>
              <Hash aria-hidden />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {name === project && <Check aria-hidden className="size-3.5" />}
            </DropdownMenuItem>
          ))}
          {projects.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => onMove('')}>{t('newProject')}</DropdownMenuItem>
          {project && <DropdownMenuItem onSelect={() => onMove(null)}>{t('removeFromProject')}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ThreadList() {
  const t = useTranslations('threads')
  const conversations = useChatStore(state => state.conversations)
  const currentId = useChatStore(state => state.currentConversationId)
  const switchConversation = useChatStore(state => state.switchConversation)
  const projectMap = useThreadsStore(state => state.projectMap)
  const tagMap = useThreadsStore(state => state.tagMap)
  const pendingCounts = usePendingCounts()
  const mode = useThreadsStore(state => state.mode)
  const query = useThreadsStore(state => state.query)
  const setQuery = useThreadsStore(state => state.setQuery)
  const moveToProject = useThreadsStore(state => state.moveToProject)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [naming, setNaming] = useState<ThreadConversation | null>(null)
  const [name, setName] = useState('')
  const [now] = useState(() => Date.now())

  const groups = useMemo(() => groupThreads(conversations, projectMap, { mode, query, keepId: currentId }), [conversations, projectMap, mode, query, currentId])
  const projects = useMemo(() => listProjects(conversations, projectMap), [conversations, projectMap])
  const total = groups.reduce((sum, group) => sum + group.threads.length, 0)

  function toggle(project: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(project)) next.delete(project)
      else next.add(project)
      return next
    })
  }

  function onMove(thread: ThreadConversation, project: string | null) {
    if (project === '') {
      setName('')
      setNaming(thread)
      return
    }
    void moveToProject(threadKey(thread), project ?? '')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pb-1">
        <div className="relative">
          <Search aria-hidden className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-ink" />
          <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} className="h-8 pl-8 text-ui-compact" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" role="list" aria-label={t('listLabel')}>
        {total === 0 && <EmptyState className="px-2 py-3" icon={MessagesSquare} text={query ? t('noMatch') : t('empty')} />}
        {groups.map(group => {
          const key = group.project
          const showHeader = mode === 'project'
          const closed = showHeader && collapsed.has(key)
          return (
            <section key={key || '__none'} className="mt-1.5" data-project={key || undefined}>
              {showHeader && (
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-expanded={!closed}
                  className="flex w-full items-center gap-1.5 rounded-(--r-kbd) px-2 py-1 text-left text-muted-ink outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <ChevronDown aria-hidden className={cn('size-3 motion-safe:transition-transform', closed && '-rotate-90')} />
                  {key ? <Hash aria-hidden className="size-3" /> : null}
                  <SectionLabel as="span" className="flex-1" trailing={<Count value={group.threads.length} />}>
                    <span className="block truncate">{key || t('ungrouped')}</span>
                  </SectionLabel>
                </button>
              )}
              {!closed && group.threads.map(thread => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  tag={tagOf(tagMap, thread)}
                  pending={pendingCounts.get(thread.id) ?? 0}
                  project={mode === 'recent' ? projectOf(projectMap, thread) : ''}
                  projects={projects}
                  current={thread.id === currentId}
                  now={now}
                  onOpen={() => void switchConversation(thread.id)}
                  onMove={project => onMove(thread, project)}
                />
              ))}
            </section>
          )
        })}
      </div>

      <Dialog open={naming !== null} onOpenChange={open => { if (!open) setNaming(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('newProject')}</DialogTitle>
            <DialogDescription>{t('newProjectHint')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            maxLength={40}
            placeholder={t('projectName')}
            aria-label={t('projectName')}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && name.trim() && naming) {
                void moveToProject(threadKey(naming), name)
                setNaming(null)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaming(null)}>{t('cancel')}</Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                if (naming) void moveToProject(threadKey(naming), name)
                setNaming(null)
              }}
            >
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ThreadsScreen() {
  const t = useTranslations('threads')
  const isV3 = useUiV3()
  const visible = useThreadsStore(state => state.visible)
  const hide = useThreadsStore(state => state.hide)
  const mode = useThreadsStore(state => state.mode)
  const setMode = useThreadsStore(state => state.setMode)
  const loadProjects = useThreadsStore(state => state.loadProjects)
  const setChatHost = useThreadsStore(state => state.setChatHost)
  const initConversations = useChatStore(state => state.initConversations)
  const startNewConversation = useChatStore(state => state.startNewConversation)
  const loading = useChatStore(state => state.loading)
  const autoCollapseRightSidebar = useSidebarStore(state => state.setThreadsRightSidebarAutoCollapse)
  const hostRef = useCallback((node: HTMLDivElement | null) => setChatHost(node), [setChatHost])
  const active = visible && isV3

  useEffect(() => {
    if (!active) return
    autoCollapseRightSidebar(true)
    return () => autoCollapseRightSidebar(false)
  }, [active, autoCollapseRightSidebar])

  useEffect(() => {
    if (!active) return
    void loadProjects()
    void initConversations()
  }, [active, initConversations, loadProjects])

  // 別的全頁覆蓋層打開時（收集頁、Inbox 頁…）收起自己；那些 store 不認識對話頁，所以由這裡訂閱。
  useEffect(() => {
    if (!active) return
    const stores = [useHomeStore, useInboxStore, usePromptLibraryStore, useCollectStore]
    const unsubscribers = stores.map(store => store.subscribe((state, prev) => {
      if ((state as { visible: boolean }).visible && !(prev as { visible: boolean }).visible) hide()
    }))
    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
  }, [active, hide])

  useEffect(() => () => setChatHost(null), [setChatHost])

  if (!active) return null

  const modes: ThreadGroupMode[] = ['project', 'recent']
  return (
    <PageSurface label={t('title')} onDismiss={hide}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        onBack={hide}
        actions={(
          <Button className={cn(V3_BUTTON_SHAPE, 'gap-2 px-3')} disabled={loading} onClick={() => void startNewConversation()}>
            <MessageSquarePlus aria-hidden className="size-4" />{t('newThread')}
          </Button>
        )}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-panel pt-2" aria-label={t('listLabel')}>
          <div className="mb-2 shrink-0 px-2">
            <Segmented
              label={t('groupBy')}
              value={mode}
              onChange={setMode}
              items={modes.map(value => ({ value, label: t(`mode.${value}`) }))}
              className="w-full [&>button]:flex-1 [&>button]:text-ui-compact"
            />
          </div>
          <ThreadList />
        </aside>
        <div
          ref={hostRef}
          className="min-w-0 flex-1 bg-bg"
          data-slot="threads-chat-host"
        />
      </div>
    </PageSurface>
  )
}

// 開發模式專用：瀏覽器沒有 Tauri 與資料庫，截圖與手動測試時從 console 塞示範資料用。正式版不會有這個。
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  Object.assign(window, { __threadsStore: useThreadsStore, __chatStore: useChatStore })
}
