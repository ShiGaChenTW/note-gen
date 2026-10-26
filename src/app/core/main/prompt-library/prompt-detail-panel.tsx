'use client'

// Fork（#53）：提示詞庫頁右欄——填變數 → 預覽 → 複製。
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Copy, FileText } from 'lucide-react'
import { readText, writeText } from 'tauri-plugin-clipboard-api'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { readNote } from '@/lib/daily/note-io'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { parseFrontmatterData } from '@/lib/vault-index/index-note'
import {
  extractVariableUsages,
  renderPromptBody,
  resolvePromptFields,
  stripVariablesSection,
  type PromptVariableField,
} from '@/lib/prompt-library/variables'
import { promptFileTitle, promptTitle } from '@/lib/prompt-library/prompt-note'
import usePromptLibraryStore from '@/stores/prompt-library'
import useVaultIndexStore from '@/stores/vault-index'

function findNoteByName(name: string, notes: ReadonlyMap<string, { path: string }>): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const withExt = trimmed.toLowerCase().endsWith('.md') ? trimmed.toLowerCase() : `${trimmed.toLowerCase()}.md`
  for (const path of notes.keys()) {
    if (path.toLowerCase() === withExt) return path
  }
  for (const path of notes.keys()) {
    if (promptFileTitle(path).toLowerCase() === trimmed.toLowerCase()) return path
  }
  return null
}

export function PromptDetailPanel({ path, onOpenNote }: { path: string, onOpenNote: () => void }) {
  const t = useTranslations('promptLibrary')
  const notes = useVaultIndexStore(state => state.notes)
  const recordUsage = usePromptLibraryStore(state => state.recordUsage)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState<Record<string, string>>({})
  const [previewText, setPreviewText] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void readNote(path).then(text => {
      if (cancelled) return
      setContent(text)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [path])

  const parsed = useMemo(() => {
    if (content === null) return null
    const { block, body } = splitFrontmatter(content)
    const frontmatter = parseFrontmatterData(block)
    const strippedBody = stripVariablesSection(body)
    const fields = resolvePromptFields(body, frontmatter?.variables)
    const usages = extractVariableUsages(strippedBody)
    return { frontmatter, body, strippedBody, fields, usages }
  }, [content])

  // 筆記換了（或填的變數有預設值）時重設表單
  useEffect(() => {
    if (!parsed) return
    setValues(current => {
      const next: Record<string, string> = {}
      for (const field of parsed.fields) next[field.name] = current[field.name] ?? field.defaultValue
      return next
    })
  }, [parsed])

  useEffect(() => {
    if (!parsed) { setPreviewText(''); return }
    let cancelled = false
    async function build() {
      const needsClipboard = parsed!.usages.some(usage => usage.kind === 'builtin' && usage.builtin === 'clipboard')
      const noteArgs = [...new Set(parsed!.usages.flatMap(usage => usage.kind === 'builtin' && usage.builtin === 'note' && usage.arg ? [usage.arg] : []))]
      const [clipboardText, noteEntries] = await Promise.all([
        needsClipboard ? readText().catch(() => '') : Promise.resolve(undefined),
        Promise.all(noteArgs.map(async arg => {
          const notePath = findNoteByName(arg, notes)
          if (!notePath) return [arg, null] as const
          const text = await readNote(notePath)
          return [arg, text === null ? null : splitFrontmatter(text).body.trim()] as const
        })),
      ])
      if (cancelled) return
      const noteMap = new Map(noteEntries)
      setPreviewText(renderPromptBody(parsed!.strippedBody, {
        now: new Date(),
        clipboardText,
        readNote: name => noteMap.get(name),
        values,
      }))
    }
    void build()
    return () => { cancelled = true }
  }, [parsed, values, notes])

  if (loading) return <div className="grid h-full place-items-center text-sm text-muted-foreground">{t('loading')}</div>
  if (content === null || !parsed) return <div className="grid h-full place-items-center text-sm text-muted-foreground">{t('loadFailed')}</div>

  const missingRequired = parsed.fields.filter(field => field.required && !values[field.name]?.trim())

  async function handleCopy() {
    try {
      await writeText(previewText)
      await recordUsage(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast.success(t('copied'))
    } catch (error) {
      console.error('[prompt-library] failed to copy:', error)
      toast.error(t('copyFailed'))
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{promptTitle({ path, frontmatter: parsed.frontmatter })}</h2>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onOpenNote}>
          <FileText className="size-3.5" aria-hidden />{t('openNote')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {parsed.fields.length > 0 && (
          <div className="mb-4 flex flex-col gap-3">
            {parsed.fields.map(field => (
              <VariableField
                key={field.name}
                field={field}
                value={values[field.name] ?? ''}
                onChange={value => setValues(current => ({ ...current, [field.name]: value }))}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('preview')}</span>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{previewText}</pre>
        </div>
      </div>

      <div className="flex h-14 shrink-0 items-center gap-2 border-t px-4">
        {missingRequired.length > 0 && (
          <span className="text-xs text-muted-foreground">{t('missingRequired', { count: missingRequired.length })}</span>
        )}
        <Button className="ml-auto gap-2" disabled={missingRequired.length > 0} onClick={() => void handleCopy()}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {t('copy')}
        </Button>
      </div>
    </div>
  )
}

function VariableField({ field, value, onChange }: {
  field: PromptVariableField
  value: string
  onChange: (value: string) => void
}) {
  const t = useTranslations('promptLibrary')
  const label = field.required ? `${field.name} *` : field.name
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {field.description && <span className="text-xs text-muted-foreground/80">{field.description}</span>}
      {field.options.length > 0 ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-full"><SelectValue placeholder={t('selectOption')} /></SelectTrigger>
          <SelectContent>
            {field.options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={value}
          aria-label={field.name}
          aria-required={field.required || undefined}
          onChange={event => onChange(event.target.value)}
        />
      )}
    </label>
  )
}
