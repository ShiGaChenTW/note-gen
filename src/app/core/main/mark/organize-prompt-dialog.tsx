'use client'

// Fork（#55）：Inbox 的「整理成提示詞」——AI 提議 → 逐欄確認（含變數統一 diff）→ 存成提示詞筆記。
import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from "react"
import { useTranslations } from 'next-intl'
import { toast } from "sonner"
import { Loader2, Lightbulb, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"

import type { Mark } from "@/db/marks"
import { noteExists, writeNote } from "@/lib/daily/note-io"
import { commitGitVersion } from "@/lib/git-versions/commands"
import { getGitVersionWorkspaceSettings } from "@/lib/git-versions/workspace-settings"
import { getWorkspaceAbsolutePath } from "@/lib/workspace"
import {
  buildPromptNoteContent,
  collectKnownVariableNames,
  generatePromptOrganizeProposal,
  PromptOrganizeAiNotConfiguredError,
  type PromptOrganizeProposal,
} from "@/lib/prompt-library/organize"
import {
  applyVariableUnifications,
  findVariableUnificationCandidates,
  groupVariableUnificationCandidates,
  type VariableUnificationCandidate,
  type VariableUnificationGroup,
} from "@/lib/prompt-library/variable-unification"
import { extractVariableUsages } from "@/lib/prompt-library/variables"
import useArticleStore from "@/stores/article"
import useDailySettingsStore from "@/stores/daily-settings"

type Step = 'loading' | 'review' | 'saving' | 'error'

function sanitizePromptFileName(title: string): string {
  const sanitized = title.trim().replace(/[/\\:*?"<>|]/g, '_').slice(0, 60)
  return sanitized || 'Prompt'
}

async function getAvailablePromptNotePath(folder: string, title: string): Promise<string> {
  const base = sanitizePromptFileName(title)
  const clean = folder.replace(/^\/+|\/+$/g, '')
  for (let attempt = 0; ; attempt++) {
    const fileName = attempt === 0 ? `${base}.md` : `${base}(${attempt}).md`
    const path = clean ? `${clean}/${fileName}` : fileName
    if (!await noteExists(path)) return path
  }
}

function splitLines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean)
}

function splitCommaList(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

export interface OpenOrganizePromptOptions {
  onOrganized?: (notePath: string, recordId: number) => void
}

export const OrganizePromptDialog = forwardRef<{ openOrganizePrompt: (record: Mark, options?: OpenOrganizePromptOptions) => void }>((_props, ref) => {
  const t = useTranslations('inbox.organizePrompt')
  const promptFolder = useDailySettingsStore(state => state.promptFolder)

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('loading')
  const [record, setRecord] = useState<Mark | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [onOrganized, setOnOrganized] = useState<OpenOrganizePromptOptions['onOrganized']>()

  const [candidates, setCandidates] = useState<VariableUnificationCandidate[]>([])
  const [groups, setGroups] = useState<VariableUnificationGroup[]>([])
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set())
  const [knownVariableNames, setKnownVariableNames] = useState<string[]>([])

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [scenariosText, setScenariosText] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [variableDescriptions, setVariableDescriptions] = useState<Record<string, string>>({})
  const [improvementSuggestions, setImprovementSuggestions] = useState<string[]>([])
  const [commitSummary, setCommitSummary] = useState('')
  const [gitEnabled, setGitEnabled] = useState(false)
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [saving, setSaving] = useState(false)

  const applyProposal = useCallback((proposal: PromptOrganizeProposal, fallbackSourceUrl: string) => {
    setTitle(proposal.title)
    setSummary(proposal.summary)
    setScenariosText(proposal.scenarios.join('\n'))
    setTagsText(proposal.tags.join(', '))
    setSourceUrl(proposal.source || fallbackSourceUrl)
    setVariableDescriptions(Object.fromEntries(proposal.variables.map(item => [item.name, item.description])))
    setImprovementSuggestions(proposal.improvementSuggestions)
    setCommitSummary(proposal.commitSummary)
  }, [])

  const runProposal = useCallback(async (targetRecord: Mark) => {
    setStep('loading')
    setErrorMessage('')
    try {
      const body = targetRecord.content ?? ''
      const foundCandidates = findVariableUnificationCandidates(body)
      const foundGroups = groupVariableUnificationCandidates(foundCandidates)
      setCandidates(foundCandidates)
      setGroups(foundGroups)
      setAcceptedIds(new Set(foundCandidates.map(candidate => candidate.id)))
      setKnownVariableNames(collectKnownVariableNames(body, foundGroups))

      const [proposal, root] = await Promise.all([
        generatePromptOrganizeProposal({ body, sourceUrl: targetRecord.url || undefined, variableGroups: foundGroups }),
        getWorkspaceAbsolutePath(),
      ])
      applyProposal(proposal, targetRecord.url || '')
      setWorkspaceRoot(root)
      const gitSettings = await getGitVersionWorkspaceSettings(root).catch(() => ({ enabled: false, autoSnapshotEnabled: true }))
      setGitEnabled(gitSettings.enabled)
      setStep('review')
    } catch (error) {
      console.error('[organize-prompt] failed to generate proposal:', error)
      setErrorMessage(
        error instanceof PromptOrganizeAiNotConfiguredError
          ? t('aiNotConfigured')
          : t('proposalFailed')
      )
      setStep('error')
    }
  }, [applyProposal, t])

  useImperativeHandle(ref, () => ({
    openOrganizePrompt: (nextRecord, options) => {
      setRecord(nextRecord)
      setOnOrganized(options?.onOrganized)
      setOpen(true)
      void runProposal(nextRecord)
    },
  }))

  const toggleGroup = useCallback((group: VariableUnificationGroup, checked: boolean) => {
    setAcceptedIds(current => {
      const next = new Set(current)
      for (const occurrence of group.occurrences) {
        if (checked) next.add(occurrence.id)
        else next.delete(occurrence.id)
      }
      return next
    })
  }, [])

  const groupChecked = useCallback((group: VariableUnificationGroup) => {
    return group.occurrences.every(occurrence => acceptedIds.has(occurrence.id))
  }, [acceptedIds])

  const finalBody = useMemo(() => {
    if (!record) return ''
    return applyVariableUnifications(record.content ?? '', candidates, acceptedIds)
  }, [record, candidates, acceptedIds])

  const finalVariableNames = useMemo(() => {
    return extractVariableUsages(finalBody)
      .filter((usage): usage is { kind: 'user', token: string, name: string } => usage.kind === 'user')
      .map(usage => usage.name)
  }, [finalBody])

  const handleClose = useCallback((nextOpen: boolean) => {
    if (saving) return
    setOpen(nextOpen)
  }, [saving])

  const handleConfirm = useCallback(async () => {
    if (!record || saving) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    setSaving(true)
    setStep('saving')
    try {
      const variableDescriptionMap = new Map(finalVariableNames.map(name => [name, variableDescriptions[name] ?? '']))
      const content = buildPromptNoteContent({
        title: trimmedTitle,
        tags: splitCommaList(tagsText),
        variableNames: finalVariableNames,
        body: finalBody,
        summary: summary.trim(),
        scenarios: splitLines(scenariosText),
        source: sourceUrl.trim(),
        variableDescriptions: variableDescriptionMap,
      })

      const notePath = await getAvailablePromptNotePath(promptFolder, trimmedTitle)
      await writeNote(notePath, content)
      await useArticleStore.getState().loadFileTree()

      if (gitEnabled && workspaceRoot) {
        try {
          await commitGitVersion(workspaceRoot, commitSummary.trim() || `新增提示詞：${trimmedTitle}`, 'prompt-version', [notePath])
        } catch (error) {
          console.error('[organize-prompt] failed to commit prompt version:', error)
        }
      }

      onOrganized?.(notePath, record.id)
      toast.success(t('saved', { title: trimmedTitle }))
      setOpen(false)
    } catch (error) {
      console.error('[organize-prompt] failed to save prompt note:', error)
      toast.error(t('saveFailed'))
      setStep('review')
    } finally {
      setSaving(false)
    }
  }, [record, saving, title, finalVariableNames, variableDescriptions, finalBody, tagsText, summary, scenariosText, sourceUrl, promptFolder, gitEnabled, workspaceRoot, commitSummary, onOrganized, t])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="size-4" aria-hidden />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {step === 'loading' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            {t('generating')}
          </div>
        ) : step === 'error' ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Lightbulb /></EmptyMedia>
                <EmptyTitle>{t('proposalFailedTitle')}</EmptyTitle>
                <EmptyDescription>{errorMessage}</EmptyDescription>
              </EmptyHeader>
              {record ? (
                <Button variant="outline" className="gap-2" onClick={() => void runProposal(record)}>
                  <RotateCcw className="size-4" aria-hidden />{t('retry')}
                </Button>
              ) : null}
            </Empty>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 p-6">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="organize-prompt-title">{t('fieldTitle')}</Label>
                <Input id="organize-prompt-title" value={title} onChange={event => setTitle(event.target.value)} disabled={saving} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="organize-prompt-summary">{t('fieldSummary')}</Label>
                <Input id="organize-prompt-summary" value={summary} onChange={event => setSummary(event.target.value)} disabled={saving} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="organize-prompt-scenarios">{t('fieldScenarios')}</Label>
                <Textarea
                  id="organize-prompt-scenarios"
                  rows={3}
                  value={scenariosText}
                  onChange={event => setScenariosText(event.target.value)}
                  placeholder={t('fieldScenariosPlaceholder')}
                  disabled={saving}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="organize-prompt-tags">{t('fieldTags')}</Label>
                <Input
                  id="organize-prompt-tags"
                  value={tagsText}
                  onChange={event => setTagsText(event.target.value)}
                  placeholder={t('fieldTagsPlaceholder')}
                  disabled={saving}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="organize-prompt-source">{t('fieldSource')}</Label>
                <Input id="organize-prompt-source" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} disabled={saving} />
              </div>

              {knownVariableNames.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <Label>{t('fieldVariables')}</Label>
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    {knownVariableNames.map(name => (
                      <div className="flex flex-col gap-1" key={name}>
                        <span className="text-xs font-medium text-muted-foreground">{`{{${name}}}`}</span>
                        <Input
                          value={variableDescriptions[name] ?? ''}
                          onChange={event => setVariableDescriptions(current => ({ ...current, [name]: event.target.value }))}
                          placeholder={t('variableDescriptionPlaceholder')}
                          disabled={saving}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {groups.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <Label>{t('fieldUnification')}</Label>
                  <p className="text-xs text-muted-foreground">{t('unificationHelp')}</p>
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    {groups.map(group => (
                      <label className="flex items-start gap-2" key={group.variableName}>
                        <Checkbox
                          checked={groupChecked(group)}
                          onCheckedChange={checked => toggleGroup(group, checked === true)}
                          disabled={saving}
                        />
                        <span className="flex min-w-0 flex-1 flex-col text-sm">
                          <span className="flex min-w-0 flex-wrap items-center gap-1">
                            {group.rawVariants.map((raw, index) => (
                              <span key={raw} className="flex items-center gap-1">
                                {index > 0 ? <span className="text-muted-foreground">/</span> : null}
                                <code className="rounded bg-muted px-1 py-0.5 text-destructive line-through">{raw}</code>
                              </span>
                            ))}
                            <span className="text-muted-foreground">→</span>
                            <code className="rounded bg-muted px-1 py-0.5 text-emerald-600 dark:text-emerald-400">{group.replacement}</code>
                          </span>
                          <span className="text-xs text-muted-foreground">{t('unificationCount', { count: group.occurrences.length })}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {improvementSuggestions.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('fieldImprovements')}</Label>
                  <p className="text-xs text-muted-foreground">{t('improvementsHelp')}</p>
                  <ul className="list-disc space-y-1 rounded-md border bg-muted/30 p-3 pl-6 text-sm text-muted-foreground">
                    {improvementSuggestions.map(item => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="organize-prompt-preview">{t('fieldPreview')}</Label>
                <pre id="organize-prompt-preview" className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{finalBody}</pre>
              </div>

              {gitEnabled ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="organize-prompt-commit-summary">{t('fieldCommitSummary')}</Label>
                  <Input
                    id="organize-prompt-commit-summary"
                    value={commitSummary}
                    onChange={event => setCommitSummary(event.target.value)}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">{t('commitSummaryHelp')}</p>
                </div>
              ) : null}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>{t('cancel')}</Button>
          {step === 'review' ? (
            <Button disabled={saving || !title.trim()} onClick={() => void handleConfirm()}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {t('confirm')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

OrganizePromptDialog.displayName = 'OrganizePromptDialog'
