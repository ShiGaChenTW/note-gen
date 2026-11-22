'use client'

// Fork（almanac ALMNC-54.8）：資料源整頁編輯器（E，v14）——格式工具列、標題、內文、字數。
// 儲存：還沒送出的原地改；已送出的另存新版本 vN、舊版保留；已整理的改過之後可以「送給 <指揮官> 更新」。⌘S 存、Esc 取消。
import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { saveSourceEdit } from '@/lib/workbench/actions'
import { applyFormat, isChanged, joinContent, splitContent, wordCount, type FormatKind } from '@/lib/workbench/source-editor'
import type { SourceListRow } from '@/lib/workbench/sources-tab'
import { cn } from '@/lib/utils'
import useWorkbenchStore from '@/stores/workbench'
import { BTN, BTN_PRIMARY, Kbd } from './review-card'

const TOOLS: Array<FormatKind | null> = ['heading', 'bold', 'italic', null, 'bullet', 'numbered', 'task', null, 'quote', 'link', 'rule']

/** 這一列存檔後會變成新版本嗎（已送出的 V3 資料源，或還沒橋接的舊資料第一次存）。 */
export function savesNewVersion(row: SourceListRow): boolean {
  return row.origin !== 'source' || row.status !== 'wait'
}

export function SourceEditor({ row, commanderName }: { row: SourceListRow, commanderName: string }) {
  const t = useTranslations('workbench.sources')
  const failT = useTranslations('workbench.toast')
  const setEditing = useWorkbenchStore(state => state.setEditing)
  const selectRow = useWorkbenchStore(state => state.selectRow)
  const initial = useMemo(() => splitContent(row.content, row.title), [row.content, row.title])
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const doc = { title, body }
  const dirty = isChanged(row.content, doc)
  const versioned = row.origin === 'source' && savesNewVersion(row)
  const nextVersion = row.version + 1

  function cancel() {
    if (dirty && !window.confirm(t('editor.confirmLeave'))) return
    setEditing(false)
  }

  async function save() {
    if (saving) return
    if (!dirty) {
      toast(t('toast.noChange'))
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const result = await saveSourceEdit(row, joinContent(doc))
      selectRow(result.rowId)
      toast(result.versioned && row.origin === 'source'
        ? t('toast.savedVersion', { version: result.version, name: commanderName })
        : t('toast.saved'))
    } catch (error) {
      console.error('[workbench] save source failed:', error)
      toast.error(failT('failed'))
    } finally {
      setSaving(false)
    }
  }

  function format(kind: FormatKind) {
    const area = bodyRef.current
    if (!area) return
    const next = applyFormat(body, area.selectionStart, area.selectionEnd, kind)
    setBody(next.text)
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(next.start, next.end)
    })
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="source-editor"
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void save()
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-6 py-3 text-[12.5px] text-muted-ink">
        <button type="button" className="flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2.5 text-ui-compact hover:bg-hover hover:text-ink" onClick={cancel}>
          <ArrowLeft className="size-4" aria-hidden />{t('editor.back')}
        </button>
        <span className="font-[650] tracking-[0.04em] text-ink">{t(`kind.${row.kind}`)}</span>
        <span data-testid="editor-heading">{t('editor.editing')}{versioned ? ` · ${t('editor.newVersion', { version: nextVersion })}` : ''}</span>
        <span className="flex-1" />
        <button type="button" className={BTN} onClick={cancel}>{t('editor.cancel')}<Kbd>Esc</Kbd></button>
        <button type="button" className={cn(BTN, BTN_PRIMARY)} disabled={saving} onClick={() => void save()} data-testid="editor-save">{t('editor.save')}<Kbd>⌘S</Kbd></button>
      </div>
      <div role="toolbar" aria-label={t('editor.toolbar')} className="flex flex-wrap items-center gap-1 border-b border-line-soft px-6 py-1.5">
        {TOOLS.map((tool, index) => tool
          ? <button key={tool} type="button" title={t(`editor.tools.${tool}`)} onMouseDown={event => event.preventDefault()} onClick={() => format(tool)} className="h-7 cursor-pointer rounded-md px-2 text-xs text-muted-ink hover:bg-hover hover:text-ink">{t(`editor.tools.${tool}`)}</button>
          : <span key={`sep${index}`} className="mx-1 h-4 w-px bg-line" aria-hidden />)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex w-full max-w-[720px] flex-col px-8 py-8 max-md:px-4">
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder={t('editor.titlePlaceholder')}
            aria-label={t('editor.titlePlaceholder')}
            className="w-full bg-transparent text-2xl leading-8 font-semibold tracking-[-0.01em] text-ink outline-none placeholder:text-faint"
          />
          <div className="mt-1 flex gap-3 text-ui-compact text-muted-ink">
            {row.from && <span className="truncate">{row.from}</span>}
            <span className="tabular-nums">{new Date(row.at).toLocaleString()}</span>
          </div>
          <textarea
            ref={bodyRef}
            value={body}
            autoFocus
            onChange={event => setBody(event.target.value)}
            placeholder={t('editor.bodyPlaceholder')}
            aria-label={t('editor.bodyPlaceholder')}
            className="mt-5 min-h-[50vh] w-full resize-none bg-transparent text-[15px] leading-7 text-note-ink outline-none placeholder:text-faint"
          />
        </article>
      </div>
      <div className="flex items-center gap-4 border-t border-line-soft px-6 py-2 text-xs text-faint">
        <span className="tabular-nums" data-testid="editor-words">{t('editor.words', { count: wordCount(doc) })}</span>
        <span>{versioned ? t('editor.keepOld', { version: row.version }) : t('editor.applyOnSave')}</span>
        <span className="flex-1" />
        <span>{dirty ? t('editor.unsaved') : t('editor.notSaved')}</span>
      </div>
    </div>
  )
}
