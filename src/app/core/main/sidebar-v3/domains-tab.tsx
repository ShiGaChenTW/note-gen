'use client'

// Fork（almanac ALMNC-54.23）：整理頁的「領域」分頁。領域最多兩層（例如「工程 › 資料工程」），每個領域列出它的知識筆記，
// 進到領域看到總覽、核心概念、重點結論（附出處筆記）、矛盾與未解問題、相關領域。內容來自領域表的總覽（lib/domain-page/model.ts 拆段落），
// 沒有寫的段落顯示空狀態，不替它編造。只在 V3 的整理頁出現。
// Fork（almanac ALMNC-69.7）：成員與段落改由 MOC 檔解析結果提供（stores/moc，MocRebuildService 更新；domainPageData），
// 還沒有 MOC 檔的舊領域退回原本的 frontmatter 反查。
// Fork（almanac ALMNC-69.8）：領域頁改成 MOC 頁五區塊——① 定位問題、② 從這裡開始（滿 6 則）、③ 章節（依章節分組＋關係說明，
// 尚未分章放最下面）、④ 重點結論、⑤ 待釐清（分矛盾／未解／知識缺口、標來源），各區塊的顯示條件在 lib/domain-page/moc-view.ts；
// 頁首是 MOC 檔讀出的上層、相關、相鄰，相鄰旁的「探索」與未歸屬清單的「新增領域」都交給 lib/domain-page/explore.ts（69.13 接手）。
// 清單頁下面是「未歸屬」：沒被任何領域收錄的知識筆記，可搜尋標題／摘要／內文、可多選。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Compass, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/v3/empty-state'
import { SectionLabel } from '@/components/v3/section-label'
import { Count } from '@/components/v3/count'
import { V3_BUTTON_SHAPE } from '@/components/v3/button-shape'
import { readNote, revealInFileTree } from '@/lib/daily/note-io'
import {
  buildDomainTree, domainPageData, findDomainNode, relatedDomains, splitWikiLinks,
  type DomainNode, type DomainNote,
} from '@/lib/domain-page/model'
import {
  filterNotes, legacyPageView, mocPageView, searchableBody, unassignedNotes,
  type HeaderItem, type MocChapterView, type MocNoteRow, type MocPageView,
} from '@/lib/domain-page/moc-view'
import { requestExplore } from '@/lib/domain-page/explore'
import { resolveWikilinkTarget } from '@/lib/markdown/wikilink'
import { useDomainPage } from '@/lib/sidebar-v3/domain-page'
import type { Domain } from '@/lib/v3-model/domain'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useVaultIndexStore from '@/stores/vault-index'
import useMocStore from '@/stores/moc'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'

type LoadState = 'loading' | 'ready' | 'error'

function useDomains(): { domains: Domain[], state: LoadState } {
  const [domains, setDomains] = useState<Domain[]>([])
  const [state, setState] = useState<LoadState>('loading')
  useEffect(() => {
    let active = true
    void import('@/db/v3-domains')
      .then(db => db.listDomains())
      .then((list) => { if (active) { setDomains(list); setState('ready') } })
      .catch((error) => { console.warn('[domains] load failed:', error); if (active) setState('error') })
    return () => { active = false }
  }, [])
  return { domains, state }
}

async function openNote(path: string) {
  await revealInFileTree(path)
  await useArticleStore.getState().setActiveFilePath(path)
}

const ROW = 'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-(--r) px-2 py-1.5 text-left text-ui-compact leading-5 text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink'

function DomainRow({ node, depth, onOpen }: { node: DomainNode, depth: number, onOpen: (id: string) => void }) {
  return (
    <li>
      <button type="button" className={ROW} style={{ paddingInlineStart: 8 + depth * 20 }} onClick={() => onOpen(node.domain.id)} data-testid="domain-row" data-domain={node.domain.id}>
        <span className={cn('min-w-0 flex-1 truncate', depth === 0 && 'font-medium')}>{node.domain.name}</span>
        <Count value={node.notes.length} showZero />
        <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
      </button>
    </li>
  )
}

function DomainList({ tree, onOpen }: { tree: DomainNode[], onOpen: (id: string) => void }) {
  const t = useTranslations('sidebarV3.domains')
  if (tree.length === 0) return <EmptyState className="px-4 py-4" text={t('empty')} />
  return (
    <ul className="flex flex-col gap-0.5 p-2" aria-label={t('label')} data-testid="domain-list">
      {tree.map(root => (
        <li key={root.domain.id}>
          <ul className="flex flex-col gap-0.5">
            <DomainRow node={root} depth={0} onOpen={onOpen} />
            {root.children.map(child => <DomainRow key={child.domain.id} node={child} depth={1} onOpen={onOpen} />)}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function NoteLinkText({ text, notePaths }: { text: string, notePaths: readonly string[] }) {
  const t = useTranslations('sidebarV3.domains')
  return (
    <>
      {splitWikiLinks(text).map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.text}</span>
        const path = resolveWikilinkTarget(part.target, notePaths)
        if (!path) return <span key={index} title={t('missingNote', { target: part.target })}>{part.label}</span>
        return (
          <button key={index} type="button" className="cursor-pointer rounded-(--r-kbd) text-ink underline underline-offset-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink" onClick={() => void openNote(path)}>
            {part.label}
          </button>
        )
      })}
    </>
  )
}

const BADGE = 'shrink-0 rounded-(--r-kbd) bg-hover px-1.5 text-ui-numeric leading-4 text-muted-ink'
const BULLET = <span className="mt-2 size-1 shrink-0 rounded-full bg-faint" aria-hidden />

/** 區塊外框：小標（可帶計數）＋內容。 */
function Block({ label, count, testId, children }: { label: string, count?: number, testId: string, children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <SectionLabel as="h2" underline trailing={count !== undefined && count > 0 ? <Count value={count} /> : undefined}>{label}</SectionLabel>
      {children}
    </section>
  )
}

function ItemList({ items, notePaths, ordered }: { items: readonly string[], notePaths: readonly string[], ordered?: boolean }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <List className="flex flex-col gap-1.5 text-ui-compact leading-5 text-ink">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          {ordered ? <span className="w-4 shrink-0 text-right font-mono text-ui-numeric leading-5 text-faint tabular-nums">{index + 1}</span> : BULLET}
          <span className="min-w-0 [overflow-wrap:anywhere]"><NoteLinkText text={item} notePaths={notePaths} /></span>
        </li>
      ))}
    </List>
  )
}

/** 頁首的領域名稱：對得到領域就能點過去，否則是純文字（例如還沒建立的領域）。 */
function HeaderLink({ item, tree, onOpen }: { item: HeaderItem, tree: DomainNode[], onOpen: (id: string) => void }) {
  const node = findDomainByName(tree, item.name)
  const note = item.note ? <span className="text-faint">（{item.note}）</span> : null
  if (!node) return <span data-testid="domain-header-item">{item.label}{note}</span>
  return (
    <span data-testid="domain-header-item">
      <button type="button" className="cursor-pointer rounded-(--r-kbd) text-ink underline underline-offset-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink" onClick={() => onOpen(node.domain.id)} data-domain={node.domain.id}>
        {item.label}
      </button>
      {note}
    </span>
  )
}

function HeaderRow({ label, items, tree, onOpen, testId, trailing }: { label: string, items: readonly HeaderItem[], tree: DomainNode[], onOpen: (id: string) => void, testId: string, trailing?: ReactNode }) {
  if (items.length === 0) return null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" data-testid={testId}>
      <span className="text-faint">{label}</span>
      {items.map((item, index) => (
        <span key={`${item.name}#${index}`} className="inline-flex items-center">
          <HeaderLink item={item} tree={tree} onOpen={onOpen} />
          {index < items.length - 1 && <span className="text-faint">、</span>}
        </span>
      ))}
      {trailing}
    </div>
  )
}

function ChapterNote({ row }: { row: MocNoteRow }) {
  const t = useTranslations('sidebarV3.domains')
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{row.title}</span>
        {row.relation && <span className="line-clamp-2 text-muted-ink" data-testid="domain-note-relation">{row.relation}</span>}
      </span>
      {row.marker && <span className={BADGE}>{t('mocMarker', { name: row.marker })}</span>}
      {row.status && row.status !== 'valid' && <span className={BADGE}>{t(`status.${row.status}`)}</span>}
    </>
  )
  if (!row.path) {
    return (
      <li>
        <div className={cn(ROW, 'cursor-default items-start text-muted-ink hover:bg-transparent')} title={t('missingNote', { target: row.target })} data-testid="domain-note" data-missing="true">{body}</div>
      </li>
    )
  }
  const path = row.path
  return (
    <li>
      <button type="button" className={cn(ROW, 'items-start')} onClick={() => void openNote(path)} aria-label={t('openNote', { title: row.title })} data-testid="domain-note" data-path={path}>
        {body}
      </button>
    </li>
  )
}

function Chapter({ chapter, exploring, tree, onOpen }: { chapter: MocChapterView, exploring: boolean, tree: DomainNode[], onOpen: (id: string) => void }) {
  const t = useTranslations('sidebarV3.domains')
  const grown = chapter.grownInto ? findDomainByName(tree, chapter.grownInto) : undefined
  return (
    <div className="flex flex-col gap-1" data-testid="domain-chapter" data-chapter={chapter.id ?? undefined} data-unsorted={chapter.unsorted || undefined}>
      <h3 className="flex min-w-0 items-center gap-2 px-2 text-ui-compact leading-5 font-semibold text-ink">
        <span className="min-w-0 truncate">{chapter.unsorted ? t('unsorted') : chapter.title}</span>
        {chapter.grownInto && (grown
          ? <button type="button" className="shrink-0 cursor-pointer rounded-(--r-kbd) text-ui-numeric font-normal text-muted-ink underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink" onClick={() => onOpen(grown.domain.id)} data-domain={grown.domain.id}>{t('grownInto', { name: chapter.grownInto })}</button>
          : <span className="shrink-0 text-ui-numeric font-normal text-muted-ink">{t('grownInto', { name: chapter.grownInto })}</span>)}
        <span className="flex-1" />
        <Count value={chapter.count} />
      </h3>
      {chapter.notes.length === 0
        ? <p className="px-2 text-ui-compact leading-5 text-muted-ink" data-testid={exploring ? 'domain-chapter-gap' : 'domain-chapter-empty'}>{exploring ? t('gapChapter') : t('emptyChapter')}</p>
        : <ul className="flex flex-col gap-0.5">{chapter.notes.map((row, index) => <ChapterNote key={`${row.target}#${index}`} row={row} />)}</ul>}
    </div>
  )
}

function OpenQuestions({ groups, notePaths }: { groups: NonNullable<MocPageView['open']>, notePaths: readonly string[] }) {
  const t = useTranslations('sidebarV3.domains')
  return (
    <div className="flex flex-col gap-3">
      {groups.map(group => (
        <div key={group.kind} className="flex flex-col gap-1.5" data-testid="domain-open-group" data-kind={group.kind}>
          <h3 className="flex items-center gap-2 text-ui-compact leading-5 font-semibold text-ink">
            {t(`openKind.${group.kind}`)}
            <Count value={group.items.length} />
          </h3>
          <ul className="flex flex-col gap-1.5 text-ui-compact leading-5 text-ink">
            {group.items.map((item, index) => (
              <li key={index} className="flex gap-2">
                {BULLET}
                <span className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
                  <span><NoteLinkText text={item.text} notePaths={notePaths} /></span>
                  <span className="text-ui-numeric leading-4 text-faint" data-testid="domain-open-source">{item.source ? t('source', { source: item.source }) : t('noSource')}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function exploreAdjacent(node: DomainNode, view: MocPageView, soon: string) {
  const handled = requestExplore({ origin: 'adjacent', domainId: node.domain.id, domainName: node.domain.name, topics: view.adjacent.map(item => item.name) })
  if (!handled) toast(soon)
}

function DomainDetail({ node, tree, view, notePaths, onOpen, onBack }: { node: DomainNode, tree: DomainNode[], view: MocPageView, notePaths: readonly string[], onOpen: (id: string) => void, onBack: () => void }) {
  const t = useTranslations('sidebarV3.domains')
  const locale = useLocale()
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(node.domain.updatedAt)
  const hasHeader = Boolean(view.parent) || view.related.length > 0 || view.adjacent.length > 0
  return (
    <article className="flex flex-col gap-5 p-4" aria-label={node.path} data-testid="domain-detail" data-domain={node.domain.id}>
      <div className="flex flex-col gap-1">
        <button type="button" className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-(--r-kbd) text-ui-compact leading-5 text-muted-ink outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink" onClick={onBack} data-testid="domain-back">
          <ChevronLeft className="size-4" aria-hidden />{t('all')}
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 text-lg leading-7 font-semibold tracking-tight text-ink">{node.path}</h2>
          {view.exploring && <span className={BADGE} data-testid="domain-exploring">{t('exploring')}</span>}
        </div>
        <p className="text-ui-compact leading-5 text-muted-ink">
          {[t('count', { count: view.noteCount }), t('updated', { date: updated }), view.owner && t('owner', { owner: view.owner }), view.confirmed && t('confirmed', { date: view.confirmed })].filter(Boolean).join(' · ')}
        </p>
        {hasHeader && (
          <div className="mt-1 flex flex-col gap-1 text-ui-compact leading-5 text-ink" data-testid="domain-header">
            <HeaderRow label={t('parent')} items={view.parent ? [view.parent] : []} tree={tree} onOpen={onOpen} testId="domain-header-parent" />
            <HeaderRow label={t('related')} items={view.related} tree={tree} onOpen={onOpen} testId="domain-header-related" />
            <HeaderRow
              label={t('adjacent')}
              items={view.adjacent}
              tree={tree}
              onOpen={onOpen}
              testId="domain-header-adjacent"
              trailing={(
                <button type="button" className={cn(V3_BUTTON_SHAPE, 'ml-1 inline-flex h-6 cursor-pointer items-center gap-1 border border-line px-2 text-ui-compact text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink')} onClick={() => exploreAdjacent(node, view, t('exploreSoon'))} aria-label={t('exploreLabel', { topics: view.adjacent.map(item => item.label).join('、') })} data-testid="domain-explore">
                  <Compass className="size-3.5" aria-hidden />{t('explore')}
                </button>
              )}
            />
          </div>
        )}
      </div>
      <Block label={t('position')} testId="domain-position">
        {view.position
          ? <p className="text-ui-compact leading-5 whitespace-pre-line text-ink [overflow-wrap:anywhere]"><NoteLinkText text={view.position} notePaths={notePaths} /></p>
          : <EmptyState text={t('emptyPosition')} />}
      </Block>
      {view.start && (
        <Block label={t('startHere')} testId="domain-start">
          <ItemList items={view.start} notePaths={notePaths} ordered />
        </Block>
      )}
      <Block label={t('chapters')} count={view.noteCount} testId="domain-chapters">
        {view.chapters.length === 0
          ? <EmptyState text={t('emptyChapters')} />
          : <div className="flex flex-col gap-3">{view.chapters.map(chapter => <Chapter key={chapter.key} chapter={chapter} exploring={view.exploring} tree={tree} onOpen={onOpen} />)}</div>}
      </Block>
      {view.conclusions && (
        <Block label={t('keyConclusions')} count={view.conclusions.length} testId="domain-conclusions">
          <ItemList items={view.conclusions} notePaths={notePaths} />
        </Block>
      )}
      {view.open && (
        <Block label={t('openQuestions')} count={view.open.reduce((sum, group) => sum + group.items.length, 0)} testId="domain-open">
          <OpenQuestions groups={view.open} notePaths={notePaths} />
        </Block>
      )}
    </article>
  )
}

/** 讀未歸屬筆記的內文給搜尋用（有輸入關鍵字才讀，讀過的留著）。 */
function useBodies(paths: readonly string[], enabled: boolean): { bodies: Map<string, string>, reading: boolean } {
  const [bodies, setBodies] = useState<Map<string, string>>(() => new Map())
  const [reading, setReading] = useState(false)
  const key = paths.join('\n')
  useEffect(() => {
    if (!enabled) return
    const missing = paths.filter(path => !bodies.has(path))
    if (missing.length === 0) return
    let active = true
    setReading(true)
    void Promise.all(missing.map(async path => [path, await readNote(path).catch(() => null)] as const))
      .then((results) => {
        if (!active) return
        setBodies((prev) => {
          const next = new Map(prev)
          for (const [path, raw] of results) next.set(path, raw === null ? '' : searchableBody(raw))
          return next
        })
      })
      .finally(() => { if (active) setReading(false) })
    return () => { active = false }
  }, [key, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return { bodies, reading }
}

function UnassignedList({ notes }: { notes: DomainNote[] }) {
  const t = useTranslations('sidebarV3.domains')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const paths = useMemo(() => notes.map(note => note.path), [notes])
  const { bodies, reading } = useBodies(paths, query.trim().length > 0)
  const shown = useMemo(() => filterNotes(notes, query, bodies), [notes, query, bodies])
  // 選了之後筆記被收進領域（不再是未歸屬）就不算選取。
  const picked = paths.filter(path => selected.has(path))
  const toggle = (path: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const create = () => {
    if (picked.length === 0) return
    if (!requestExplore({ origin: 'unassigned', notePaths: picked })) toast(t('exploreSoon'))
  }
  return (
    <section className="flex flex-col gap-2 px-4 pt-2 pb-4" data-testid="domain-unassigned" aria-label={t('unassigned.title')}>
      <SectionLabel as="h2" underline trailing={<Count value={notes.length} />}>{t('unassigned.title')}</SectionLabel>
      <p className="text-ui-compact leading-5 text-muted-ink">{t('unassigned.hint')}</p>
      {notes.length === 0
        ? <EmptyState text={t('unassigned.empty')} />
        : (
            <>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
                  <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('unassigned.search')} aria-label={t('unassigned.search')} data-testid="unassigned-search" className={cn(V3_BUTTON_SHAPE, 'w-full min-w-0 border border-line bg-bg pr-2 pl-7 text-ui-compact text-ink outline-none focus-visible:ring-1 focus-visible:ring-ink/60')} />
                </div>
                <button type="button" disabled={picked.length === 0} onClick={create} data-testid="unassigned-create" className={cn(V3_BUTTON_SHAPE, 'inline-flex shrink-0 cursor-pointer items-center gap-1 bg-ink px-3 text-ui-compact text-bg outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40')}>
                  <Plus className="size-3.5" aria-hidden />{t('unassigned.create')}
                </button>
              </div>
              {picked.length > 0 && <p className="text-ui-compact leading-5 text-muted-ink" data-testid="unassigned-selected">{t('unassigned.selected', { count: picked.length })}</p>}
              {reading && <p role="status" className="text-ui-compact leading-5 text-muted-ink">{t('unassigned.readingBodies')}</p>}
              {shown.length === 0
                ? <EmptyState text={t('unassigned.noMatch', { query: query.trim() })} />
                : (
                    <ul className="flex flex-col gap-0.5">
                      {shown.map(note => (
                        <li key={note.path} className="flex items-start gap-1" data-testid="unassigned-note" data-path={note.path}>
                          <input type="checkbox" className="mt-2.5 ml-2 shrink-0 cursor-pointer" checked={selected.has(note.path)} onChange={() => toggle(note.path)} aria-label={t('unassigned.select', { title: note.title })} />
                          <button type="button" className={cn(ROW, 'items-start')} onClick={() => void openNote(note.path)} aria-label={t('openNote', { title: note.title })}>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-medium">{note.title}</span>
                              {note.summary && <span className="line-clamp-2 text-muted-ink">{note.summary}</span>}
                            </span>
                            {note.status !== 'valid' && <span className={BADGE}>{t(`status.${note.status}`)}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
            </>
          )}
    </section>
  )
}

function findDomainByName(tree: readonly DomainNode[], name: string): DomainNode | undefined {
  const key = name.trim().toLowerCase()
  for (const root of tree) {
    if (root.domain.name.trim().toLowerCase() === key) return root
    const child = root.children.find(item => item.domain.name.trim().toLowerCase() === key)
    if (child) return child
  }
  return undefined
}

export function DomainsTab() {
  const t = useTranslations('sidebarV3.domains')
  const { domains: rows, state: rowState } = useDomains()
  const status = useVaultIndexStore(store => store.status)
  const notes = useVaultIndexStore(store => store.notes)
  const revision = useVaultIndexStore(store => store.revision)
  const mocs = useMocStore(store => store.mocs)
  const mocsLoaded = useMocStore(store => store.loaded)
  const domainId = useDomainPage(store => store.domainId)
  const open = useDomainPage(store => store.open)
  const notePaths = useMemo(() => [...notes.keys()], [notes, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const resolve = useMemo(() => {
    const lookup = buildLinkLookup(notePaths)
    return (target: string, mocPath: string | undefined) => resolveWikilinkTargetWithLookup(target, lookup, mocPath ?? '')
  }, [notePaths])
  const data = useMemo(() => domainPageData(rows, mocs, notes, resolve), [rows, mocs, notes, resolve])
  const tree = useMemo(() => buildDomainTree(data.domains, data.notesByDomain), [data])
  // 未歸屬＝知識筆記裡、不在任何領域頁成員裡的（有 MOC 的領域看正式收錄；還沒有 MOC 檔的舊領域看 frontmatter）。
  const unassigned = useMemo(() => {
    const assigned = new Set<string>()
    for (const list of data.notesByDomain.values()) for (const note of list) assigned.add(note.path)
    return unassignedNotes(notes.values(), assigned)
  }, [data, notes, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  // 筆記庫索引好了、MOC 還沒解析過時先顯示載入中，避免先閃一次舊的 frontmatter 結果。
  const state: LoadState = rowState === 'ready' && status === 'ready' && !mocsLoaded ? 'loading' : rowState
  const node = domainId ? findDomainNode(tree, domainId) : undefined
  const view = useMemo(() => {
    if (!node) return null
    const moc = data.mocByDomain.get(node.domain.id)
    if (moc) return mocPageView(moc, notes, resolve, mocs)
    const sections = data.sectionsByDomain.get(node.domain.id) ?? { summary: '', coreConcepts: [], keyConclusions: [], openQuestions: [] }
    return legacyPageView(sections, node.notes, relatedDomains(tree, node.domain.id).parent?.domain.name)
  }, [node, data, notes, resolve, mocs, tree])

  let body
  if (state === 'loading') body = <p role="status" className="px-4 py-4 text-ui-compact leading-5 text-muted-ink">{t('loading')}</p>
  else if (state === 'error') body = <EmptyState className="px-4 py-4" text={t('loadError')} />
  else if (domainId && !node) body = <EmptyState className="px-4 py-4" text={t('missing')} action={<button type="button" className="cursor-pointer text-ui-compact text-ink underline underline-offset-2" onClick={() => open(null)}>{t('all')}</button>} />
  else if (node && view) body = <DomainDetail node={node} tree={tree} view={view} notePaths={notePaths} onOpen={open} onBack={() => open(null)} />
  else if (status !== 'ready') body = <><p role="status" className="px-4 pt-3 text-ui-compact leading-5 text-muted-ink">{t('indexing')}</p>{tree.length > 0 && <DomainList tree={tree} onOpen={open} />}</>
  else body = <><DomainList tree={tree} onOpen={open} /><UnassignedList notes={unassigned} /></>

  return <div className="h-full overflow-y-auto" aria-label={t('label')}>{body}</div>
}
