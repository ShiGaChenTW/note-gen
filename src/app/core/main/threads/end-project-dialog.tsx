'use client'

// Fork（almanac ALMNC-89）：「結束專案」的確認框與結束／取消封存動作（含提示訊息）。
// 對話頁的專案分組與專案筆記的編輯器工具列共用這一套，背後都是 stores/threads 的 endProject／reopenProject。
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import useThreadsStore from '@/stores/threads'

export function EndProjectDialog({ project, onConfirm, onCancel }: {
  /** 要結束的專案；null＝不顯示。 */
  project: string | null
  onConfirm: (project: string) => void
  onCancel: () => void
}) {
  const t = useTranslations('threads')
  return (
    <Dialog open={project !== null} onOpenChange={open => { if (!open) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('endProjectTitle', { name: project ?? '' })}</DialogTitle>
          <DialogDescription>{t('endProjectHint')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button onClick={() => { if (project) onConfirm(project) }}>{t('endProjectConfirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 結束專案／取消封存，完成後跳提示。notePath：從專案筆記本身操作時，這篇一定算進去。 */
export function useProjectArchiveActions() {
  const t = useTranslations('threads')
  const endProject = useThreadsStore(state => state.endProject)
  const reopenProject = useThreadsStore(state => state.reopenProject)

  async function end(project: string, notePath?: string) {
    try {
      const { notes, failed } = await endProject(project, notePath ? { notePath } : undefined)
      toast.success(t('endProjectDone', { name: project, count: notes }))
      if (failed.length > 0) toast.error(t('endProjectFailed', { count: failed.length }))
    } catch (error) {
      console.error('[project-archive] 結束專案失敗：', error)
      toast.error(t('endProjectFailed', { count: 1 }))
    }
  }

  async function reopen(project: string, notePath?: string) {
    try {
      await reopenProject(project, notePath ? { notePath } : undefined)
      toast.success(t('reopenProjectDone', { name: project }))
    } catch (error) {
      console.error('[project-archive] 取消封存失敗：', error)
    }
  }

  return { end, reopen }
}
