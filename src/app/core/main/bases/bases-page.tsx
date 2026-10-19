'use client'

// Fork (Phase 2-3b, 軌道 A)：`.base` 檔案的整頁檢視（取代 2-3b 起點的佔位元件；export 與 props 不能改）。
// 讀檔用 readNote，YAML 解析在 src/lib/bases/format.ts，評估與渲染在 bases-view.tsx。
// 索引 watcher 不管 `.base`，所以分頁每次變成作用中時重讀，右上角也有「重新整理」。
// 本段只讀不寫：「原始碼」是唯讀 textarea。

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Code, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { readNote } from '@/lib/daily/note-io'
import { noteKeyOf } from '@/lib/markdown/wikilink'
import { parseBase } from '@/lib/bases/format'
import { BasesDocument } from './bases-view'

export default function BasesPage({ filePath, isActive = true }: { filePath: string; isActive?: boolean }) {
  const t = useTranslations('bases')
  const [text, setText] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    readNote(filePath)
      .then(content => {
        if (cancelled) return
        setText(content ?? '')
        setLoadError(null)
      })
      .catch(error => {
        if (cancelled) return
        console.error('[bases] read failed', error)
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => { cancelled = true }
  }, [filePath, isActive, reloadTick])

  const parsed = useMemo(() => (text === null ? null : parseBase(text)), [text])
  const name = noteKeyOf(filePath).replace(/\.base$/i, '')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h1 className="truncate text-sm font-medium" title={filePath}>{name}</h1>
        <span className="text-xs text-muted-foreground">{t('title')}</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('refresh')}
          aria-label={t('refresh')}
          onClick={() => setReloadTick(tick => tick + 1)}
        >
          <RefreshCw />
        </Button>
        <Button
          variant={showSource ? 'secondary' : 'ghost'}
          size="icon-sm"
          title={t('source')}
          aria-label={t('source')}
          aria-pressed={showSource}
          onClick={() => setShowSource(value => !value)}
        >
          <Code />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loadError ? (
          <p className="text-sm text-destructive">{t('parseError', { message: loadError })}</p>
        ) : text === null || parsed === null ? (
          <p className="text-sm text-muted-foreground">{t('indexing')}</p>
        ) : showSource ? (
          <Textarea
            readOnly
            value={text}
            rows={12}
            maxRows={40}
            spellCheck={false}
            className="min-h-48 font-mono text-xs"
          />
        ) : (
          <BasesDocument base={parsed.base} errors={parsed.errors} />
        )}
      </div>
    </div>
  )
}
