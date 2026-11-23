'use client'

// Fork（almanac ALMNC-54.23）：整理頁的「領域」分頁。領域最多兩層（例如「工程 › 資料工程」），每個領域列出它的知識筆記，
// 進到領域看到總覽、核心概念、重點結論（附出處筆記）、矛盾與未解問題、相關領域。內容來自領域表的總覽（lib/domain-page/model.ts 拆段落），
// 沒有寫的段落顯示空狀態，不替它編造。只在 V3 的整理頁出現。
// Fork（almanac ALMNC-69.7）：成員與段落改由 MOC 檔解析結果提供（stores/moc，MocRebuildService 更新；domainPageData），
// 還沒有 MOC 檔的舊領域退回原本的 frontmatter 反查。畫面改版在 ALMNC-69.8。
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/v3/empty-state'
import { SectionLabel } from '@/components/v3/section-label'
import { Count } from '@/components/v3/count'
import { revealInFileTree } from '@/lib/daily/note-io'
import {
  buildDomainTree, domainPageData, findDomainNode, relatedDomains, splitWikiLinks,
  type DomainNode, type DomainNote, type DomainSections,
} from '@/lib/domain-page/model'
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

function Section({ label, items, empty, notePaths, testId }: { label: string, items: readonly string[], empty: string, notePaths: readonly string[], testId: string }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <SectionLabel as="h2" underline trailing={items.length > 0 ? <Count value={items.length} /> : undefined}>{label}</SectionLabel>
      {items.length === 0
        ? <EmptyState text={empty} />
        : (
            <ul className="flex flex-col gap-1.5 text-ui-compact leading-5 text-ink">
              {items.map((item, index) => (
                <li key={index} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-faint" aria-hidden />
                  <span className="min-w-0 [overflow-wrap:anywhere]"><NoteLinkText text={item} notePaths={notePaths} /></span>
                </li>
              ))}
            </ul>
          )}
    </section>
  )
}

function NoteRow({ note }: { note: DomainNote }) {
  const t = useTranslations('sidebarV3.domains')
  return (
    <li>
      <button type="button" className={cn(ROW, 'items-start')} onClick={() => void openNote(note.path)} aria-label={t('openNote', { title: note.title })} data-testid="domain-note" data-path={note.path}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{note.title}</span>
          {note.summary && <span className="line-clamp-2 text-muted-ink">{note.summary}</span>}
        </span>
        {note.status !== 'valid' && <span className="shrink-0 rounded-(--r-kbd) bg-hover px-1.5 text-ui-numeric leading-4 text-muted-ink">{t(`status.${note.status}`)}</span>}
      </button>
    </li>
  )
}

function RelatedGroup({ label, nodes, onOpen }: { label: string, nodes: DomainNode[], onOpen: (id: string) => void }) {
  if (nodes.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2 text-ui-numeric leading-4 text-faint">{label}</span>
      <ul className="flex flex-col gap-0.5">{nodes.map(node => <DomainRow key={node.domain.id} node={node} depth={0} onOpen={onOpen} />)}</ul>
    </div>
  )
}

const EMPTY_SECTIONS: DomainSections = { summary: '', coreConcepts: [], keyConclusions: [], openQuestions: [] }

function DomainDetail({ node, tree, sections = EMPTY_SECTIONS, notePaths, onOpen, onBack }: { node: DomainNode, tree: DomainNode[], sections?: DomainSections, notePaths: readonly string[], onOpen: (id: string) => void, onBack: () => void }) {
  const t = useTranslations('sidebarV3.domains')
  const locale = useLocale()
  const related = relatedDomains(tree, node.domain.id)
  const hasRelated = Boolean(related.parent) || related.children.length > 0 || related.siblings.length > 0
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(node.domain.updatedAt)
  return (
    <article className="flex flex-col gap-5 p-4" aria-label={node.path} data-testid="domain-detail" data-domain={node.domain.id}>
      <div className="flex flex-col gap-1">
        <button type="button" className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-(--r-kbd) text-ui-compact leading-5 text-muted-ink outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink" onClick={onBack} data-testid="domain-back">
          <ChevronLeft className="size-4" aria-hidden />{t('all')}
        </button>
        <h2 className="text-lg leading-7 font-semibold tracking-tight text-ink">{node.path}</h2>
        <p className="text-ui-compact leading-5 text-muted-ink">{t('count', { count: node.notes.length })} · {t('updated', { date: updated })}</p>
      </div>
      <section className="flex flex-col gap-2" data-testid="domain-overview">
        <SectionLabel as="h2" underline>{t('overview')}</SectionLabel>
        {sections.summary
          ? <p className="text-ui-compact leading-5 whitespace-pre-line text-ink [overflow-wrap:anywhere]"><NoteLinkText text={sections.summary} notePaths={notePaths} /></p>
          : <EmptyState text={t('emptyOverview')} />}
      </section>
      <Section label={t('coreConcepts')} items={sections.coreConcepts} empty={t('emptyCoreConcepts')} notePaths={notePaths} testId="domain-core-concepts" />
      <Section label={t('keyConclusions')} items={sections.keyConclusions} empty={t('emptyKeyConclusions')} notePaths={notePaths} testId="domain-key-conclusions" />
      <Section label={t('openQuestions')} items={sections.openQuestions} empty={t('emptyOpenQuestions')} notePaths={notePaths} testId="domain-open-questions" />
      <section className="flex flex-col gap-2" data-testid="domain-notes">
        <SectionLabel as="h2" underline trailing={<Count value={node.notes.length} />}>{t('notes')}</SectionLabel>
        {node.notes.length === 0
          ? <EmptyState text={t('emptyNotes')} />
          : <ul className="flex flex-col gap-0.5">{node.notes.map(note => <NoteRow key={note.path} note={note} />)}</ul>}
      </section>
      <section className="flex flex-col gap-2" data-testid="domain-related">
        <SectionLabel as="h2" underline>{t('related')}</SectionLabel>
        {hasRelated
          ? (
              <div className="flex flex-col gap-2">
                <RelatedGroup label={t('parent')} nodes={related.parent ? [related.parent] : []} onOpen={onOpen} />
                <RelatedGroup label={t('children')} nodes={related.children} onOpen={onOpen} />
                <RelatedGroup label={t('siblings')} nodes={related.siblings} onOpen={onOpen} />
              </div>
            )
          : <EmptyState text={t('emptyRelated')} />}
      </section>
    </article>
  )
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
  const data = useMemo(() => {
    const lookup = buildLinkLookup(notePaths)
    return domainPageData(rows, mocs, notes, (target, mocPath) => resolveWikilinkTargetWithLookup(target, lookup, mocPath ?? ''))
  }, [rows, mocs, notes, notePaths])
  const tree = useMemo(() => buildDomainTree(data.domains, data.notesByDomain), [data])
  // 筆記庫索引好了、MOC 還沒解析過時先顯示載入中，避免先閃一次舊的 frontmatter 結果。
  const state: LoadState = rowState === 'ready' && status === 'ready' && !mocsLoaded ? 'loading' : rowState
  const node = domainId ? findDomainNode(tree, domainId) : undefined

  let body
  if (state === 'loading') body = <p role="status" className="px-4 py-4 text-ui-compact leading-5 text-muted-ink">{t('loading')}</p>
  else if (state === 'error') body = <EmptyState className="px-4 py-4" text={t('loadError')} />
  else if (domainId && !node) body = <EmptyState className="px-4 py-4" text={t('missing')} action={<button type="button" className="cursor-pointer text-ui-compact text-ink underline underline-offset-2" onClick={() => open(null)}>{t('all')}</button>} />
  else if (node) body = <DomainDetail node={node} tree={tree} sections={data.sectionsByDomain.get(node.domain.id)} notePaths={notePaths} onOpen={open} onBack={() => open(null)} />
  else if (status !== 'ready' && tree.length > 0) body = <><p role="status" className="px-4 pt-3 text-ui-compact leading-5 text-muted-ink">{t('indexing')}</p><DomainList tree={tree} onOpen={open} /></>
  else body = <DomainList tree={tree} onOpen={open} />

  return <div className="h-full overflow-y-auto" aria-label={t('label')}>{body}</div>
}
