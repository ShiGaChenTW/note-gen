'use client'

// Fork（almanac ALMNC-54.16）：V3 編輯頁內文上方的標題欄位。標題就是檔名去掉 .md，按 Enter 或離開欄位時改檔名；
// 空白維持原名、非法字元換成「-」、同名自動加「 (1)」不覆蓋。Enter 或下方向鍵把游標移到內文開頭。classic 不顯示。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { generateUniqueFilename } from '@/lib/default-filename'
import { useUiV3 } from '@/lib/fork-ui'
import { isMarkdownDocPath, planTitleCommit, titleFromPath } from '@/lib/new-doc/title'
import { useTitleFocusStore } from '@/lib/new-doc/title-focus'
import { renameWorkspaceFile, type RenameWorkspaceFileResult } from '../../file/rename-workspace-file'

export interface CommitDocTitleDeps {
  /** 回傳資料夾裡不重複的檔名（含 .md）。 */
  uniqueName: (parent: string, base: string) => Promise<string>
  rename: (path: string, target: string) => Promise<RenameWorkspaceFileResult>
}

const defaultDeps: CommitDocTitleDeps = {
  uniqueName: generateUniqueFilename,
  rename: (path, target) => renameWorkspaceFile(path, target),
}

export type CommitDocTitleResult = { path: string, status: RenameWorkspaceFileResult | 'unchanged' }

/** 把標題欄位的文字套到檔名上，回傳之後的路徑（沒改名就是原路徑）。 */
export async function commitDocTitle(path: string, input: string, deps: CommitDocTitleDeps = defaultDeps): Promise<CommitDocTitleResult> {
  const plan = planTitleCommit(path, input)
  if (!plan) return { path, status: 'unchanged' }
  const fileName = await deps.uniqueName(plan.parent, plan.base)
  const target = plan.parent ? `${plan.parent}/${fileName}` : fileName
  const status = await deps.rename(path, target)
  return { path: status === 'renamed' ? target : path, status }
}

type FocusableEditor = { isDestroyed?: boolean, commands: { focus: (position: 'start') => boolean } }

/** 把游標放到內文開頭；編輯器還沒好（或已銷毀）時回傳 false。 */
export function focusEditorBodyStart(editor: FocusableEditor | null | undefined): boolean {
  if (!editor || editor.isDestroyed) return false
  editor.commands.focus('start')
  return true
}

interface DocTitleFieldProps {
  path: string
  /** 把游標放到內文開頭。 */
  onFocusBody: () => void
  disabled?: boolean
  commit?: (path: string, input: string) => Promise<CommitDocTitleResult>
}

export function DocTitleField(props: DocTitleFieldProps) {
  const isV3 = useUiV3()
  if (!isV3 || !isMarkdownDocPath(props.path)) return null
  return <DocTitleInput {...props} />
}

function DocTitleInput({ path, onFocusBody, disabled = false, commit = commitDocTitle }: DocTitleFieldProps) {
  const t = useTranslations('editor.docTitle')
  const [value, setValue] = useState(() => titleFromPath(path))
  const inputRef = useRef<HTMLInputElement>(null)
  // 改名後分頁的路徑要等下一次重繪才會傳進來；這段時間裡的 blur 用這個路徑判斷，避免拿舊路徑再改一次。
  const pathRef = useRef(path)
  const runningRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    pathRef.current = path
    setValue(titleFromPath(path))
  }, [path])

  // 新增文件時取走焦點請求：游標進標題欄位並全選。等一個 tick，讓編輯器自己的初始焦點先跑完。
  useEffect(() => {
    if (useTitleFocusStore.getState().pendingPath !== path) return
    const timer = setTimeout(() => {
      if (!useTitleFocusStore.getState().consume(path)) return
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [path])

  function run(): Promise<void> {
    if (runningRef.current) return runningRef.current
    const current = pathRef.current
    const input = inputRef.current?.value ?? value
    const task = (async () => {
      try {
        const result = await commit(current, input)
        pathRef.current = result.path
        setValue(titleFromPath(result.path))
        if (result.status === 'exists') toast({ title: t('renameFailed'), description: t('fileExists'), variant: 'destructive' })
        if (result.status === 'busy') toast({ title: t('renameFailed'), description: t('busy'), variant: 'destructive' })
      } catch (error) {
        setValue(titleFromPath(current))
        toast({ title: t('renameFailed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
      } finally {
        runningRef.current = null
      }
    })()
    runningRef.current = task
    return task
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault()
      void run().then(onFocusBody)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setValue(titleFromPath(pathRef.current))
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      disabled={disabled}
      onChange={event => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => { void run() }}
      aria-label={t('label')}
      placeholder={t('placeholder')}
      spellCheck={false}
      data-doc-title
      // pt-11：編輯區右上角的筆記工具列（top-2、高 28px，到 36px）整條在標題上方，標題再長也不會被壓到。
      className="mb-2 block w-full border-0 bg-transparent px-4 pt-11 pb-0 text-[1.75em] leading-tight font-semibold text-ink outline-none placeholder:text-faint disabled:opacity-60"
    />
  )
}
