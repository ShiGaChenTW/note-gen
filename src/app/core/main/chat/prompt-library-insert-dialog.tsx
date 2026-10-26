'use client'

// Fork（#57）：對話輸入框叫出個人提示詞庫的一則提示詞——填變數 → 插入輸入框，或用來開新對話。
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  parsePromptModelSuggestion,
  resolvePromptModelSuggestion,
  type ResolvedPromptModelSuggestion,
} from '@/lib/prompt-library/chat-model-suggestion'
import usePromptLibraryStore from '@/stores/prompt-library'
import useSettingStore from '@/stores/setting'
import useVaultIndexStore from '@/stores/vault-index'

export interface PromptInsertResult {
  text: string
  modelRef: string | null
  resolvedModel: ResolvedPromptModelSuggestion | null
}

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

export function PromptLibraryInsertDialog({ path, onOpenChange, onInsert, onStartNewConversation }: {
  path: string | null
  onOpenChange: (open: boolean) => void
  onInsert: (result: PromptInsertResult) => void
  onStartNewConversation: (result: PromptInsertResult) => void
}) {
  const t = useTranslations('promptLibrary')
  const notes = useVaultIndexStore(state => state.notes)
  const aiModelList = useSettingStore(state => state.aiModelList)
  const recordUsage = usePromptLibraryStore(state => state.recordUsage)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState<Record<string, string>>({})
  const [previewText, setPreviewText] = useState('')

  useEffect(() => {
    if (!path) return
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
    if (!path || content === null) return null
    const { block, body } = splitFrontmatter(content)
    const frontmatter = parseFrontmatterData(block)
    const strippedBody = stripVariablesSection(body)
    const fields = resolvePromptFields(body, frontmatter?.variables)
    const usages = extractVariableUsages(strippedBody)
    const modelSuggestion = parsePromptModelSuggestion(frontmatter)
    const resolvedModel = modelSuggestion ? resolvePromptModelSuggestion(modelSuggestion, aiModelList) : null
    return { frontmatter, body, strippedBody, fields, usages, modelSuggestion, resolvedModel }
  }, [path, content, aiModelList])

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
      const noteArgs = [...new Set(parsed!.usages.flatMap(usage => usage.kind === 'builtin' && usage.builtin === 'note' && usage.arg ? [usage.arg] : []))]
      const noteEntries = await Promise.all(noteArgs.map(async arg => {
        const notePath = findNoteByName(arg, notes)
        if (!notePath) return [arg, null] as const
        const text = await readNote(notePath)
        return [arg, text === null ? null : splitFrontmatter(text).body.trim()] as const
      }))
      if (cancelled) return
      const noteMap = new Map(noteEntries)
      let clipboardText: string | undefined
      try {
        const needsClipboard = parsed!.usages.some(usage => usage.kind === 'builtin' && usage.builtin === 'clipboard')
        if (needsClipboard) {
          const { readText } = await import('tauri-plugin-clipboard-api')
          clipboardText = await readText().catch(() => '')
        }
      } catch {
        clipboardText = ''
      }
      if (cancelled) return
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

  const missingRequired = parsed?.fields.filter(field => field.required && !values[field.name]?.trim()) ?? []
  const canUse = Boolean(parsed) && missingRequired.length === 0

  function buildResult(): PromptInsertResult | null {
    if (!parsed) return null
    return {
      text: previewText,
      modelRef: parsed.modelSuggestion?.modelRef ?? null,
      resolvedModel: parsed.resolvedModel,
    }
  }

  async function handleInsert() {
    const result = buildResult()
    if (!result || !path) return
    await recordUsage(path)
    onInsert(result)
  }

  async function handleStartNewConversation() {
    const result = buildResult()
    if (!result || !path) return
    await recordUsage(path)
    onStartNewConversation(result)
  }

  return (
    <Dialog open={Boolean(path)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">
            {path && parsed ? promptTitle({ path, frontmatter: parsed.frontmatter }) : path}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading || !parsed ? (
            <div className="grid h-24 place-items-center text-sm text-muted-foreground">{t('loading')}</div>
          ) : (
            <div className="flex flex-col gap-4">
              {parsed.fields.length > 0 && (
                <div className="flex flex-col gap-3">
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
                <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{previewText}</pre>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {missingRequired.length > 0 && (
            <span className="text-xs text-muted-foreground">{t('missingRequired', { count: missingRequired.length })}</span>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" disabled={!canUse} onClick={() => void handleStartNewConversation()}>
              {t('insertDialog.startNewConversation')}
            </Button>
            <Button disabled={!canUse} onClick={() => void handleInsert()}>
              {t('insertDialog.insert')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
