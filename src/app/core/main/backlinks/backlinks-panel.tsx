'use client'

import { useTranslations } from 'next-intl'
import { findWikilinks, noteKeyOf } from '@/lib/markdown/wikilink'
import { revealInFileTree } from '@/lib/daily/note-io'
import type { IndexedLink } from '@/lib/vault-index/index-note'
import type { BacklinkRef } from '@/lib/vault-index/links'
import useArticleStore from '@/stores/article'
import useVaultIndexStore, { selectBacklinks, selectOutgoingLinks } from '@/stores/vault-index'

/** 索引保留上下文；從中找回原始連結，避免重組時遺失表格轉義或 block ref。 */
function HighlightedContext({ link }: { link: IndexedLink }) {
  const occurrence = link.kind === 'wikilink'
    ? findWikilinks(link.context).find(item => item.target === link.target && item.alias === link.alias && item.heading === link.heading && item.embed === link.embed)
    : null
  const text = occurrence?.raw ?? (link.alias || link.target)
  const markdownStart = link.context.indexOf(`[${link.alias}](`)
  const start = occurrence?.column ?? (link.kind === 'markdown' && markdownStart >= 0 ? markdownStart + 1 : link.context.indexOf(text))
  if (start < 0 || !text) return <>{link.context}</>
  return <>{link.context.slice(0, start)}<mark className="rounded bg-primary/10 text-primary">{text}</mark>{link.context.slice(start + text.length)}</>
}

export default function BacklinksPanel() {
  const t = useTranslations('backlinks')
  const path = useArticleStore(state => state.activeFilePath) ?? ''
  const status = useVaultIndexStore(state => state.status)
  const backlinks = useVaultIndexStore(state => selectBacklinks(state, path))
  const outgoing = useVaultIndexStore(state => selectOutgoingLinks(state, path))
  const groups = new Map<string, BacklinkRef[]>()
  for (const link of backlinks) {
    const group = groups.get(link.sourcePath) ?? []
    group.push(link)
    groups.set(link.sourcePath, group)
  }

  async function openNote(sourcePath: string) {
    await revealInFileTree(sourcePath)
    await useArticleStore.getState().setActiveFilePath(sourcePath)
  }

  return (
    <aside aria-label={t('title')} className="h-full overflow-y-auto p-3 text-sm">
      {!/\.md$/i.test(path) ? <p className="py-4 text-muted-foreground">{t('notMarkdown')}</p>
        : status !== 'ready' ? <p role="status" className="py-4 text-muted-foreground">{t('indexing')}</p>
          : <>
            <section aria-label={t('linked')}>
              <h2 className="mb-3 font-semibold">{t('linked')} <span className="text-primary">{backlinks.length}</span></h2>
              {backlinks.length === 0 && <p className="py-4 text-muted-foreground">{t('empty')}</p>}
              {[...groups].map(([sourcePath, links]) => {
                const folder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
                return (
                  <div key={sourcePath} className="mb-3 rounded-lg border p-2">
                    <h3 className="mb-1 font-medium [overflow-wrap:anywhere]">{noteKeyOf(sourcePath)}</h3>
                    {folder && <p className="mb-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{folder}</p>}
                    <ul className="grid gap-1">
                      {links.map((link, index) => (
                        <li key={`${link.line}:${index}`}>
                          <button type="button" onClick={() => void openNote(sourcePath)} className="w-full cursor-pointer rounded p-2 text-left [overflow-wrap:anywhere] hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">
                            <HighlightedContext link={link} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </section>
            <details open className="mt-4 border-t pt-3">
              <summary className="cursor-pointer font-semibold">{t('outgoing')} <span className="text-primary">{outgoing.length}</span></summary>
              <ul className="mt-2 grid gap-1">
                {outgoing.map((link, index) => (
                  <li key={`${link.line}:${index}`} className="rounded px-2 py-1 [overflow-wrap:anywhere]">
                    {link.target || noteKeyOf(path)}
                    {!link.target && link.heading && `#${link.heading}`}
                    {link.resolved === null && <span className="ml-2 text-xs text-muted-foreground">{t('unresolved')}</span>}
                  </li>
                ))}
              </ul>
            </details>
          </>}
    </aside>
  )
}
