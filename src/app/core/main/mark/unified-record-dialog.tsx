'use client'

import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Captions, FileAudio, FileUp, ImagePlus, Link2, Mail, Mic, Plus, Rss, ScanText, Square } from 'lucide-react'
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
import { addNewSource } from '@/lib/workbench/actions'
import { newSourceType } from '@/lib/workbench/judgement'
import { openAddSource, openWorkbench } from '@/lib/workbench/open'
import { useCommanderName } from '@/lib/workbench/use-workbench'
import { MBOX_LIMIT } from '@/lib/source-import/email'
import {
  DROP_EXTENSIONS, extensionOf, importEmailFiles, importMeetingFiles, MEETING_EXTENSIONS, pickImportFiles, readDroppedFiles, type ImportFile, type ImportSummary,
} from '@/lib/source-import/import-files'
import { rssErrorText, rssSubscribeErrorText } from '@/lib/source-import/rss-errors'

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

/**
 * Fork（almanac ALMNC-54.18）：target="source" 時改開「新增資料源」（和 V3 側欄↓同一個對話框），標題列在 V3 用這個；
 * 沒給 target 照舊開記錄對話框。
 */
export function UnifiedRecordButton({ compact = false, target }: { compact?: boolean, target?: 'source' }) {
  const t = useTranslations()
  const { isRecording, recordingDuration } = useRecordingStore()
  const label = target === 'source' ? t('workbench.quick.addSource') : t('record.mark.unified.title')
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size={compact ? 'icon' : 'sm'}
        variant={compact ? 'ghost' : 'outline'}
        aria-label={label}
        title={label}
        onClick={target === 'source' ? openAddSource : () => emitter.emit('unified-record-open')}
      >
        <Plus />
        {!compact && <span>{label}</span>}
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
  const rssT = useTranslations('settings.rss')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const onboardingPrefillRef = useRef<string | null>(null)
  const [open, setOpen] = useState(false)
  // Fork（almanac ALMNC-54.8）：側欄「新增資料源」（N）沿用這個對話框；source 模式存進 V3 資料源表，不寫 Inbox 記錄。
  const [target, setTarget] = useState<'record' | 'source'>('record')
  const commanderName = useCommanderName()
  const [selection, setSelection] = useState<UnifiedRecordSelection>('auto')
  const [text, setText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  // Fork（almanac ALMNC-54.10）：貼上的字數；資料源模式下大部分是貼上的文字算外部擷取（等你決定＋初步判斷），自己打的算自己寫的（R2）。
  const pastedCharsRef = useRef(0)
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

    const openDialog = (payload?: { type?: UnifiedRecordSelection; prefillText?: string; target?: 'source' }) => {
      setTarget(payload?.target ?? 'record')
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
    pastedCharsRef.current = 0
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
    // 資料源模式：錄音、截圖、插圖、檔案仍走原本的原生流程（存成記錄），工作台的資料源分頁會把記錄一起列出。
    if (target === 'source') openWorkbench('sources')
  }

  const saveSource = async (value: string) => {
    const todoDraft = resolveUnifiedTodoDraft(text, todo)
    const type = resolvedType === 'link' || resolvedType === 'todo' || resolvedType === 'prompt-draft' ? resolvedType : 'text'
    const content = type === 'link'
      ? normalizeUnifiedLinkUrl(value)
      : type === 'todo'
        ? [todoDraft.title, todoDraft.description].filter(Boolean).join('\n\n')
        : value
    const rowId = await addNewSource({ type, content, origin: type === 'prompt-draft' ? sourceUrl.trim() || undefined : undefined, pastedChars: pastedCharsRef.current })
    const external = newSourceType({ type, content, pastedChars: pastedCharsRef.current }) === 'external'
    toast({ title: external ? t('workbench.add.savedLink') : t('workbench.add.saved', { name: commanderName }) })
    openWorkbench('sources', rowId)
  }

  // Fork（almanac ALMNC-57）：資料源模式的檔案入口（Email、會議逐字稿）。選檔或拖進對話框；一封信／一場會議一則外部資料源（等你決定），重複的跳過。
  const importToast = (kind: 'email' | 'meeting', summary: ImportSummary): boolean => {
    const failures = summary.failures ?? []
    const failed = failures.length ? t('workbench.import.meetingFailed', { count: failures.length, names: failures.map(failure => failure.name).join('、') }) : ''
    if (!summary.total) {
      const empty = t(kind === 'email' ? 'workbench.import.emailEmpty' : 'workbench.import.meetingEmpty')
      toast({ title: t('common.warning'), description: [empty, failed].filter(Boolean).join(' '), variant: 'destructive' })
      return false
    }
    const notes = [
      summary.skipped > 0 ? t('workbench.import.skipped', { count: summary.skipped }) : '',
      summary.dropped > 0 ? t('workbench.import.truncated', { total: summary.total - summary.duplicates, limit: MBOX_LIMIT }) : '',
      failed,
    ].filter(Boolean).join(' ')
    const added = kind === 'email' ? 'workbench.import.emailAdded' : 'workbench.import.meetingAdded'
    toast({ title: summary.added ? t(added, { count: summary.added }) : t('workbench.import.nothingNew'), ...(notes ? { description: notes } : {}) })
    return true
  }

  const runImport = async (loadGroups: () => Promise<Array<['email' | 'meeting', ImportFile[]]>>) => {
    if (saving) return
    setSaving(true)
    try {
      let imported = false
      let firstRowId: string | undefined
      for (const [kind, files] of await loadGroups()) {
        if (!files.length) continue
        const summary = kind === 'email' ? await importEmailFiles(files) : await importMeetingFiles(files)
        if (importToast(kind, summary)) imported = true
        firstRowId ??= summary.firstRowId
      }
      if (imported) {
        setOpen(false)
        openWorkbench('sources', firstRowId)
      }
    } catch (error) {
      toast({ title: t('workbench.import.failed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const pickAndImport = (kind: 'email' | 'meeting') => void runImport(async () => [[kind, await pickImportFiles(kind === 'meeting'
    ? { filterName: t('workbench.import.meeting'), extensions: [...MEETING_EXTENSIONS] }
    // Mail.app 匯出的 .mbox 是資料夾，裡面的「mbox」檔沒有副檔名，所以 Email 不限制副檔名（看內容判斷）。
    : {})]])

  // Fork（almanac ALMNC-57.2）：資料源模式貼的是網址時可以直接訂閱 RSS（網站首頁也行，會自動找 feed）；第一次只收最新 10 篇。
  const subscribeRss = async () => {
    if (saving) return
    setSaving(true)
    try {
      const { default: useRssStore } = await import('@/lib/source-import/rss-store')
      const { feed, result } = await useRssStore.getState().subscribe({ url: text.trim() })
      if (!result.ok) {
        toast({ title: t('workbench.import.failed'), description: rssErrorText(rssT, result.error ?? { code: 'unknown' }), variant: 'destructive' })
        return
      }
      toast({ title: t('workbench.import.rssSubscribed', { name: feed.name, count: result.added }) })
      resetAfterSave()
      openWorkbench('sources')
    } catch (error) {
      toast({ title: t('workbench.import.failed'), description: rssSubscribeErrorText(rssT, error), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const acceptsFileDrop = (event: DragEvent<HTMLDivElement>) => target === 'source' && Array.from(event.dataTransfer.types).includes('Files')

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsFileDrop(event)) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    const of = (extensions: readonly string[]) => files.filter(file => extensions.includes(extensionOf(file.name)))
    const emails = of(DROP_EXTENSIONS.email)
    const meetings = of(DROP_EXTENSIONS.meeting)
    if (emails.length || meetings.length) {
      void runImport(async () => [['email', await readDroppedFiles(emails)], ['meeting', await readDroppedFiles(meetings)]])
    } else if (files.length) {
      toast({ title: t('workbench.import.dropUnsupported') })
    }
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
      if (target === 'source') {
        await saveSource(value)
      } else if (resolvedType === 'link') {
        await saveLink(value)
      } else if (resolvedType === 'todo') {
        const result = await insertMark({
          tagId: selectedTagId,
          type: 'todo',
          desc: todoDraft.title,
          content: JSON.stringify(todoDraft),
          url: '',
        })
        const todoMarkId = Number(result.lastInsertId || 0)
        if (todoMarkId) {
          const todoContent = [todoDraft.title, todoDraft.description].filter(Boolean).join('\n\n')
          void import('@/lib/workbench/actions').then(({ registerRecordText }) => registerRecordText({ markId: todoMarkId, type: 'todo', content: todoContent })).catch(() => undefined)
        }
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
        // Fork（almanac ALMNC-54.10，R2）：V3 存成記錄的隨手記、Prompt 素材也一樣自己打的就自動交給指揮官（貼上的不收）。
        const markId = Number(result.lastInsertId || 0)
        if (markId && (resolvedType === 'text' || resolvedType === 'prompt-draft')) {
          const origin = resolvedType === 'prompt-draft' ? sourceUrl.trim() : undefined
          const pastedChars = pastedCharsRef.current
          void import('@/lib/workbench/actions').then(({ registerRecordText }) => registerRecordText({ markId, type: resolvedType, content: value, origin, pastedChars })).catch(() => undefined)
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
            <DialogTitle className="text-base">{target === 'source' ? t('workbench.add.title') : t('record.mark.unified.title')}</DialogTitle>
            <DialogDescription className="text-xs">{target === 'source' ? t('workbench.add.subtitle') : t('record.mark.unified.subtitle')}</DialogDescription>
          </div>
        </DialogHeader>
        <div
          className="space-y-3"
          onDragOver={event => { if (acceptsFileDrop(event)) event.preventDefault() }}
          onDrop={handleFileDrop}
        >
          <Textarea
            ref={inputRef}
            value={text}
            rows={expanded ? 10 : 6}
            maxRows={expanded ? 24 : 12}
            disabled={saving}
            placeholder={t('record.mark.unified.placeholder')}
            onChange={event => {
              if (!event.target.value) pastedCharsRef.current = 0
              setText(event.target.value)
            }}
            onPaste={event => { pastedCharsRef.current += Array.from(event.clipboardData.getData('text')).length }}
          />
          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => triggerMedia('image')}><ImagePlus />{t('record.mark.type.image')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => triggerMedia('file')}><FileUp />{t('record.mark.type.file')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => triggerMedia('recording')}><Mic />{t('record.mark.type.recording')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => triggerMedia('scan')}><ScanText />{t('record.mark.type.screenshot')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={triggerAudioFile}><FileAudio />{t('record.mark.unified.selectAudioFile')}</Button>
            {target === 'source' && (
              <>
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => pickAndImport('email')}><Mail />{t('workbench.import.email')}</Button>
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => pickAndImport('meeting')}><Captions />{t('workbench.import.meeting')}</Button>
              </>
            )}
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
          {target === 'record' && <RecordSaveTarget selectedTagId={selectedTagId} tags={tags} disabled={saving} onTagChange={setSelectedTagId} onCreatingChange={setCreatingTag} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => setExpanded(value => !value)}>
            {t(expanded ? 'record.mark.unified.collapse' : 'record.mark.unified.expand')}
          </Button>
          {target === 'source' && resolvedType === 'link' && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => void subscribeRss()}><Rss />{t('workbench.import.subscribeRss')}</Button>
          )}
          <Button type="button" disabled={saving || creatingTag} onClick={() => void handleSave()}>
            {resolvedType === 'link' ? t('record.mark.unified.captureLink') : t('record.mark.unified.saveAs', { type: typeLabel })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
