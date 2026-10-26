'use client'

// Fork（#32）：最近筆記。最新一篇顯示成大卡片並附摘要，其餘列出；點了打開並回到工作區。
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FileText } from 'lucide-react'
import { readNote } from '@/lib/daily/note-io'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import useArticleStore from '@/stores/article'
import useHomeStore from '@/stores/home'
import useVaultIndexStore from '@/stores/vault-index'

function title(path: string) {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? path
}

function relative(ms: number, locale: string) {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour')
  return rtf.format(-Math.round(minutes / 1440), 'day')
}

function excerptOf(content: string) {
  const body = splitFrontmatter(content).body
  return body.replace(/^#+\s.*$/gm, '').replace(/[*_`>#[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

export function RecentNotes() {
  const t = useTranslations('home.recent')
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const hide = useHomeStore(state => state.hide)
  const recent = useMemo(
    () => [...notes.values()].filter(note => note.mtime > 0 && note.path.toLowerCase().endsWith('.md')).sort((a, b) => b.mtime - a.mtime).slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes, revision],
  )
  const [excerpt, setExcerpt] = useState('')
  const first = recent[0]
  useEffect(() => {
    let cancelled = false
    if (!first) return
    void readNote(first.path).then(content => { if (!cancelled) setExcerpt(content ? excerptOf(content) : '') }).catch(() => undefined)
    return () => { cancelled = true }
  }, [first?.path, first?.mtime])

  const open = (path: string) => {
    void useArticleStore.getState().setActiveFilePath(path)
    hide()
  }
  const locale = typeof navigator === 'undefined' ? 'en' : navigator.language

  return (
    <section className="rounded-xl bg-background p-4" aria-labelledby="home-recent">
      <h2 id="home-recent" className="mb-2 text-[15px] font-semibold">{t('title')}</h2>
      {!first && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {first && (
        <button type="button" className="mb-2 block w-full rounded-lg bg-muted p-3 text-left hover:bg-accent" onClick={() => open(first.path)}>
          <div className="flex items-center gap-2 text-sm font-medium"><FileText className="size-3.5" aria-hidden />{title(first.path)}</div>
          {excerpt && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{excerpt}</p>}
          <div className="mt-1 text-xs text-muted-foreground">{relative(first.mtime, locale)}</div>
        </button>
      )}
      <ul className="grid gap-0.5">
        {recent.slice(1).map(note => (
          <li key={note.path}>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-accent" onClick={() => open(note.path)}>
              <span className="min-w-0 flex-1 truncate">{title(note.path)}</span>
              <span className="text-xs text-muted-foreground">{relative(note.mtime, locale)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
