'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { FileAudio, FileUp, ImagePlus, Link2, Mic, Plus, ScanText, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RecordSaveTarget } from './record-save-target'
import { TodoForm, type TodoFormData } from './todo-form'
import { insertMark } from '@/db/marks'
import { captureLink } from '@/lib/link-capture'
import { localizeCapturedImages, removeLinkAssetGroup } from '@/lib/web-capture/images'
import { getRecordSaveTagIdFromTags } from '@/lib/record-save-target'
import { normalizeUnifiedLinkUrl, resolveUnifiedRecordShortcut, resolveUnifiedRecordType, resolveUnifiedTodoDraft, type UnifiedRecordSelection, type UnifiedRecordType, unifiedRecordTypes } from '@/lib/unified-record-input'
import emitter from '@/lib/emitter'
import { toast } from '@/hooks/use-toast'
import useMarkStore from '@/stores/mark'
import useRecordingStore from '@/stores/recording'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'
import { useRecordCompletion } from './use-record-completion'
import { useTranslations } from 'next-intl'
import { v4 as uuid } from 'uuid'

const typeIcon: Record<UnifiedRecordType, ReactNode> = {
  link: <Link2 />,
  text: null,
  image: <ImagePlus />,
  file: <FileUp />,
  recording: <Mic />,
  scan: <ScanText />,
  todo: null,
  'prompt-draft': null,
}

type UnifiedMediaType = 'image' | 'file' | 'recording' | 'scan'

function isMediaType(type: UnifiedRecordType): type is UnifiedMediaType {
  return type === 'image' || type === 'file' || type === 'recording' || type === 'scan'
}

function typeTranslationKey(type: UnifiedRecordType) {
  return type === 'scan' ? 'screenshot' : type
}

function formatRecordingDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}

export function UnifiedRecordButton({ compact = false }: { compact?: boolean }) {
  const t = useTranslations()
  const { isRecording, recordingDuration } = useRecordingStore()
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size={compact ? 'icon' : 'sm'}
        variant={compact ? 'ghost' : 'outline'}
        aria-label={t('record.mark.unified.title')}
        title={t('record.mark.unified.title')}
        onClick={() => emitter.emit('unified-record-open')}
      >
        <Plus />
        {!compact && <span>{t('record.mark.unified.title')}</span>}
      </Button>
      {isRecording && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-red-500 hover:text-red-600"
          aria-label={t('record.mark.unified.stopRecording')}
          title={t('record.mark.unified.stopRecording')}
          onClick={() => emitter.emit('toolbar-shortcut-recording')}
        >
          <Square className="fill-current" />
          <span className="tabular-nums">{formatRecordingDuration(recordingDuration)}</span>
        </Button>
      )}
    </div>
  )
}

export function UnifiedRecordDialog() {
  const t = useTranslations()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const onboardingPrefillRef = useRef<string | null>(null)
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<UnifiedRecordSelection>('auto')
  const [text, setText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [modifierLabel, setModifierLabel] = useState('⌘')
  const [saving, setSaving] = useState(false)
  const [creatingTag, setCreatingTag] = useState(false)
  const [todo, setTodo] = useState<TodoFormData>({ title: '', description: '', priority: 'medium' })
  const { currentTagId, tags, fetchTags, initTags } = useTagStore()
  const [selectedTagId, setSelectedTagId] = useState(currentTagId)
  const { addQueue, setQueue, removeQueue } = useMarkStore()
  const completeRecord = useRecordCompletion()

  const resolvedType = resolveUnifiedRecordType(selection, text)
  const typeLabel = t(`record.mark.type.${typeTranslationKey(resolvedType)}`)

  const prepareTags = useCallback(async () => {
    await initTags()
    await fetchTags()
    const tagState = useTagStore.getState()
    const settingState = useSettingStore.getState()
    setSelectedTagId(getRecordSaveTagIdFromTags({
      mode: settingState.recordSaveTargetMode,
      currentTagId: tagState.currentTagId,
      lastTagId: settingState.lastRecordTagId,
      fixedTagId: settingState.fixedRecordTagId,
      tagIds: tagState.tags.map(tag => tag.id),
    }))
  }, [fetchTags, initTags])

  useEffect(() => {
    if (!navigator.platform.toLowerCase().includes('mac')) setModifierLabel('Alt+')

    const openDialog = (payload?: { type?: UnifiedRecordSelection; prefillText?: string }) => {
      setSelection(payload?.type ?? 'auto')
      const prefillText = payload?.prefillText ?? onboardingPrefillRef.current
      if (prefillText) setText(prefillText)
      setOpen(true)
    }
    const handleQuickRecord = (payload?: { prefillText?: string }) => openDialog({ type: 'text', prefillText: payload?.prefillText })
    const handleOnboardingPrefillChange = (payload?: { prefillText?: string }) => {
      onboardingPrefillRef.current = payload?.prefillText || null
    }
    emitter.on('unified-record-open', openDialog)
    emitter.on('quickRecordTextHandler', handleQuickRecord)
    emitter.on('onboarding-record-prefill-changed', handleOnboardingPrefillChange)
    return () => {
      emitter.off('unified-record-open', openDialog)
      emitter.off('quickRecordTextHandler', handleQuickRecord)
      emitter.off('onboarding-record-prefill-changed', handleOnboardingPrefillChange)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setCreatingTag(false)
      return
    }
    void prepareTags()
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open, prepareTags])

  const resetAfterSave = () => {
    setText('')
    setSourceUrl('')
    setTodo({ title: '', description: '', priority: 'medium' })
    setExpanded(false)
    setSelection('auto')
    setOpen(false)
  }

  // 關閉視窗不清空草稿：媒體流程有自己的原生視窗，結束後重新打開仍可接著寫。
  const triggerMedia = (type: UnifiedMediaType) => {
    setOpen(false)
    emitter.emit(`toolbar-shortcut-${type}` as never)
  }

  const triggerAudioFile = () => {
    setOpen(false)
    emitter.emit('toolbar-shortcut-recording-file')
  }

  const saveLink = async (value: string) => {
    const targetUrl = normalizeUnifiedLinkUrl(value)
    const queueId = uuid()
    addQueue({ queueId, tagId: selectedTagId, type: 'link', progress: '0%', startTime: Date.now() })
    let shouldCleanupAssets = false
    try {
      setQueue(queueId, { progress: '30%' })
      const page = await captureLink(targetUrl)
      setQueue(queueId, { progress: '65%' })
      const localizedImages = await localizeCapturedImages(page, queueId)
      shouldCleanupAssets = localizedImages.savedPaths.length > 0
      setQueue(queueId, { progress: '90%' })
      const fallbackContent = page.excerpt
        ? page.method === 'search'
          ? `> ${t('record.mark.link.searchExcerpt')}\n>\n> ${page.excerpt}`
          : page.excerpt
        : ''
      const result = await insertMark({
        tagId: selectedTagId,
        type: 'link',
        desc: page.title,
        content: localizedImages.contentMarkdown || fallbackContent,
        url: page.canonicalUrl || page.finalUrl || targetUrl,
      })
      shouldCleanupAssets = false
      await completeRecord({ markId: Number(result.lastInsertId || 0) || null, tagId: selectedTagId, typeLabel })
      if (page.status !== 'success') {
        toast({
          title: t('record.mark.link.savedPartialTitle'),
          description: page.method === 'search'
            ? t('record.mark.link.savedFromSearch')
            : t(`record.mark.link.captureStatus.${page.status}`),
        })
      }
    } catch (error) {
      if (shouldCleanupAssets) await removeLinkAssetGroup(queueId)
      throw error
    } finally {
      removeQueue(queueId)
    }
  }

  const handleSave = async () => {
    if (saving || creatingTag) return
    const value = text.trim()
    if (isMediaType(resolvedType)) {
      triggerMedia(resolvedType)
      return
    }
    const todoDraft = resolveUnifiedTodoDraft(text, todo)
    if (resolvedType === 'todo' && !todoDraft.title) {
      toast({ title: t('common.warning'), description: t('record.mark.todo.titlePlaceholder'), variant: 'destructive' })
      return
    }
    if (!value && resolvedType !== 'todo') {
      toast({ title: t('common.warning'), description: t('record.mark.text.description'), variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      if (resolvedType === 'link') {
        await saveLink(value)
      } else if (resolvedType === 'todo') {
        const result = await insertMark({
          tagId: selectedTagId,
          type: 'todo',
          desc: todoDraft.title,
          content: JSON.stringify(todoDraft),
          url: '',
        })
        await completeRecord({ markId: Number(result.lastInsertId || 0) || null, tagId: selectedTagId, typeLabel })
      } else {
        const result = await insertMark({
          tagId: selectedTagId,
          type: resolvedType,
          desc: resolvedType === 'text' ? value : undefined,
          content: value,
          url: resolvedType === 'prompt-draft' ? sourceUrl.trim() : undefined,
        })
        if (resolvedType === 'text') {
          emitter.emit('onboarding-step-complete', { step: 'create-record' })
          emitter.emit('onboarding-record-prefill-changed', {})
        }
        await completeRecord({ markId: Number(result.lastInsertId || 0) || null, tagId: selectedTagId, typeLabel })
      }
      resetAfterSave()
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return
    const shortcut = resolveUnifiedRecordShortcut(event.nativeEvent, navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'windows')
    if (shortcut) {
      event.preventDefault()
      setSelection(shortcut)
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSave()
    }
  }

  const showFullFields = resolvedType === 'todo' || resolvedType === 'prompt-draft'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader className="pr-8">
          <div className="flex items-baseline gap-2">
            <DialogTitle className="text-base">{t('record.mark.unified.title')}</DialogTitle>
            <DialogDescription className="text-xs">{t('record.mark.unified.subtitle')}</DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            ref={inputRef}
            value={text}
            rows={expanded ? 10 : 6}
            maxRows={expanded ? 24 : 12}
            disabled={saving}
            placeholder={t('record.mark.unified.placeholder')}
            onChange={event => setText(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => triggerMedia('image')}><ImagePlus />{t('record.mark.type.image')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => triggerMedia('file')}><FileUp />{t('record.mark.type.file')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => triggerMedia('recording')}><Mic />{t('record.mark.type.recording')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => triggerMedia('scan')}><ScanText />{t('record.mark.type.screenshot')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={triggerAudioFile}><FileAudio />{t('record.mark.unified.selectAudioFile')}</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2 font-medium">{typeIcon[resolvedType]}<span>{t(selection === 'auto' ? 'record.mark.unified.detected' : 'record.mark.unified.manual', { type: typeLabel })}</span></div>
            <select
              value={selection}
              aria-label={t('record.mark.unified.typeLabel')}
              disabled={saving}
              className="ml-auto h-8 rounded-md border bg-background px-2 text-xs"
              onChange={event => setSelection(event.target.value as UnifiedRecordSelection)}
            >
              <option value="auto">{t('record.mark.unified.autoDetect')} · {modifierLabel}0</option>
              {unifiedRecordTypes.map((type, index) => <option key={type} value={type}>{t(`record.mark.type.${typeTranslationKey(type)}`)} · {modifierLabel}{index + 1}</option>)}
            </select>
          </div>
          {showFullFields && (
            <div className="space-y-3 border-t pt-3">
              {resolvedType === 'todo' ? (
                <TodoForm mode="create" data={todo} onChange={setTodo} autoFocus={false} />
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="unified-record-source">{t('record.mark.promptDraft.source')}</Label>
                  <Input id="unified-record-source" value={sourceUrl} disabled={saving} placeholder={t('record.mark.promptDraft.sourcePlaceholder')} onChange={event => setSourceUrl(event.target.value)} />
                </div>
              )}
            </div>
          )}
          <RecordSaveTarget selectedTagId={selectedTagId} tags={tags} disabled={saving} onTagChange={setSelectedTagId} onCreatingChange={setCreatingTag} />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => setExpanded(value => !value)}>
            {t(expanded ? 'record.mark.unified.collapse' : 'record.mark.unified.expand')}
          </Button>
          <Button type="button" disabled={saving || creatingTag} onClick={() => void handleSave()}>
            {resolvedType === 'link' ? t('record.mark.unified.captureLink') : t('record.mark.unified.saveAs', { type: typeLabel })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
