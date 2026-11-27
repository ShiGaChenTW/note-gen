'use client'

// Fork（almanac ALMNC-89）：專案筆記（frontmatter type: project）開著時，編輯器工具列的「結束專案…／取消封存」。
// 跟對話頁專案分組的入口同一套：同一個確認框、stores/threads 的 endProject／reopenProject、同一份 archivedProjects 紀錄。
// 專案名＝筆記標題（frontmatter title → 第一個 H1 → 檔名），同名的對話分組也會一起從進行中清單移走。
import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ToolbarIconButton } from '@/components/v3/toolbar'
import { findArchivedProject } from '@/lib/projects/archive'
import { normalizeProjectName } from '@/lib/threads/projects'
import { parseV3Note } from '@/lib/v3-model/note'
import useThreadsStore from '@/stores/threads'
import { EndProjectDialog, useProjectArchiveActions } from '../threads/end-project-dialog'

/** 這篇是專案筆記就回傳專案名與狀態；不是（或 frontmatter 壞掉）回傳 null。 */
export function projectNoteInfo(raw: string | null, path: string, heading?: string): { name: string, archived: boolean } | null {
  if (!raw) return null
  try {
    const { fields } = parseV3Note(raw)
    if (fields.type !== 'project') return null
    const fallback = heading?.trim() || (path.split('/').pop() ?? '').replace(/\.md$/i, '')
    const name = normalizeProjectName(fields.title?.trim() || fallback)
    return name ? { name, archived: fields.status === 'archived' } : null
  } catch {
    return null
  }
}

export function ProjectArchiveButton({ notePath, raw, heading }: {
  notePath: string
  /** 編輯器裡 frontmatter 的原文（含前後 ---）。 */
  raw: string | null
  /** 內文第一個 H1；frontmatter 沒寫 title 時當專案名。 */
  heading?: string
}) {
  const t = useTranslations('threads')
  const archivedProjects = useThreadsStore(state => state.archivedProjects)
  const loadProjects = useThreadsStore(state => state.loadProjects)
  const { end, reopen } = useProjectArchiveActions()
  const [ending, setEnding] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const info = useMemo(() => projectNoteInfo(raw, notePath, heading), [raw, notePath, heading])

  useEffect(() => { if (info) void loadProjects().catch(() => undefined) }, [info, loadProjects])

  if (!info) return null
  const archived = info.archived || !!findArchivedProject(archivedProjects, info.name)
  const label = archived ? t('reopenProject') : t('endProject')

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarIconButton
              aria-label={label}
              disabled={busy}
              onClick={() => {
                if (archived) void run(() => reopen(info.name, notePath))
                else setEnding(info.name)
              }}
            >
              {archived ? <ArchiveRestore /> : <Archive />}
            </ToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{label}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <EndProjectDialog
        project={ending}
        onCancel={() => setEnding(null)}
        onConfirm={project => {
          setEnding(null)
          void run(() => end(project, notePath))
        }}
      />
    </>
  )
}
