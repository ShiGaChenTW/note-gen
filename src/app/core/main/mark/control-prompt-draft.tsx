// Fork（#55）：記錄一段 Prompt 素材——貼上原文、可附來源 URL，進 Inbox 待整理成提示詞。
import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Textarea } from "@/components/ui/textarea"
import { insertMark } from "@/db/marks"
import useTagStore from "@/stores/tag"
import { Lightbulb } from "lucide-react"
import { useEffect, useState, useCallback, useRef } from "react"
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { Store } from '@tauri-apps/plugin-store'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { RecordSaveTarget } from './record-save-target'
import { useRecordCompletion } from './use-record-completion'
import useSettingStore from '@/stores/setting'
import { getRecordSaveTagIdFromTags } from '@/lib/record-save-target'

export function ControlPromptDraft() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [creatingTag, setCreatingTag] = useState(false)
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const completeRecord = useRecordCompletion()

  const { currentTagId, tags, fetchTags, initTags } = useTagStore()
  const [selectedTagId, setSelectedTagId] = useState<number>(currentTagId)

  async function handleSuccess() {
    if (creatingTag) return
    const resetText = text.trim()

    if (!resetText) {
      toast({
        title: t('common.warning'),
        description: t('record.mark.promptDraft.description'),
        variant: 'destructive',
      })
      return
    }

    try {
      const store = await Store.load('store.json')
      await store.set('currentTagId', selectedTagId)
      await store.save()

      const result = await insertMark({ tagId: selectedTagId, type: 'prompt-draft', content: resetText, url: sourceUrl.trim() })
      const markId = Number(result.lastInsertId || 0) || null

      await completeRecord({
        markId,
        tagId: selectedTagId,
        typeLabel: t('record.mark.type.prompt-draft'),
      })

      setText('')
      setSourceUrl('')
      setOpen(false)
    } catch (error) {
      console.error('Failed to save prompt draft record:', error)
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
    }
  }

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
  }, [])

  useEffect(() => {
    if (!open) {
      setCreatingTag(false)
      return
    }

    let cancelled = false
    const prepareTags = async () => {
      await initTags()
      await fetchTags()
      if (!cancelled) {
        const tagState = useTagStore.getState()
        const settingState = useSettingStore.getState()
        setSelectedTagId(getRecordSaveTagIdFromTags({
          mode: settingState.recordSaveTargetMode,
          currentTagId: tagState.currentTagId,
          lastTagId: settingState.lastRecordTagId,
          fixedTagId: settingState.fixedRecordTagId,
          tagIds: tagState.tags.map((tag) => tag.id),
        }))
      }
    }

    void prepareTags()
    return () => {
      cancelled = true
    }
  }, [fetchTags, initTags, open])

  useEffect(() => {
    if (!open || isMobile) return

    const focusTimer = window.setTimeout(() => {
      textAreaRef.current?.focus()
    }, 50)

    return () => window.clearTimeout(focusTimer)
  }, [isMobile, open])

  const handleDrawerAnimationEnd = useCallback((drawerOpen: boolean) => {
    if (!drawerOpen) return

    textAreaRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleShortcutOpen = () => setOpen(true)
    emitter.on('toolbar-shortcut-prompt-draft', handleShortcutOpen)
    return () => {
      emitter.off('toolbar-shortcut-prompt-draft', handleShortcutOpen)
    }
  }, [])

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange} onAnimationEnd={handleDrawerAnimationEnd}>
          <DrawerTrigger asChild>
            <TooltipButton buttonId="onboarding-target-record-prompt-draft" icon={<Lightbulb />} tooltipText={t('record.mark.type.prompt-draft')} />
          </DrawerTrigger>
          <DrawerContent onEscapeKeyDown={event => { if (creatingTag) event.preventDefault() }}>
            <DrawerHeader>
              <DrawerTitle>{t('record.mark.promptDraft.title')}</DrawerTitle>
              <DrawerDescription>
                {t('record.mark.promptDraft.description')}
              </DrawerDescription>
            </DrawerHeader>
            <div className="space-y-4 px-4">
              <RecordSaveTarget
                mobile
                selectedTagId={selectedTagId}
                tags={tags}
                onTagChange={setSelectedTagId}
                onCreatingChange={setCreatingTag}
              />
              <Textarea
                ref={textAreaRef}
                rows={10}
                maxRows={24}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('record.mark.promptDraft.contentPlaceholder')}
              />
              <div className="space-y-1.5">
                <Label htmlFor="prompt-draft-source-mobile">{t('record.mark.promptDraft.source')}</Label>
                <Input
                  id="prompt-draft-source-mobile"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder={t('record.mark.promptDraft.sourcePlaceholder')}
                />
              </div>
            </div>
            <DrawerFooter className="flex items-center justify-between gap-4">
              <p className="text-sm text-zinc-500">{t('record.mark.text.characterCount', { count: text.length })}</p>
              <Button type="submit" disabled={creatingTag} onClick={handleSuccess}>{t('record.mark.promptDraft.save')}</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <TooltipButton buttonId="onboarding-target-record-prompt-draft" icon={<Lightbulb />} tooltipText={t('record.mark.type.prompt-draft')} />
          </DialogTrigger>
          <DialogContent onEscapeKeyDown={event => { if (creatingTag) event.preventDefault() }} className="min-w-full md:min-w-[650px]">
            <DialogHeader>
              <DialogTitle>{t('record.mark.promptDraft.title')}</DialogTitle>
              <DialogDescription>
                {t('record.mark.promptDraft.description')}
              </DialogDescription>
            </DialogHeader>
            <RecordSaveTarget
              selectedTagId={selectedTagId}
              tags={tags}
              onTagChange={setSelectedTagId}
              onCreatingChange={setCreatingTag}
            />
            <Textarea
              ref={textAreaRef}
              rows={10}
              maxRows={30}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('record.mark.promptDraft.contentPlaceholder')}
              autoFocus
            />
            <div className="space-y-1.5">
              <Label htmlFor="prompt-draft-source">{t('record.mark.promptDraft.source')}</Label>
              <Input
                id="prompt-draft-source"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder={t('record.mark.promptDraft.sourcePlaceholder')}
              />
            </div>
            <DialogFooter className="flex items-center justify-between gap-4">
              <p className="text-sm text-zinc-500">{t('record.mark.text.characterCount', { count: text.length })}</p>
              <Button type="submit" disabled={creatingTag} onClick={handleSuccess}>{t('record.mark.promptDraft.save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
