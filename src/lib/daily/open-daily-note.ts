/**
 * 開啟今日筆記（D1）：不存在就依模板建立，已存在絕不覆蓋，最後在編輯器打開。
 * I/O 層；內容產生在 daily-note-content.ts。
 */

import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { writeSelfHostedWorkspaceText } from '@/lib/self-hosted-sync/files'
import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import { dailyNotePath } from './format'
import { buildDailyNoteContent } from './daily-note-content'

async function pathExists(relativePath: string): Promise<boolean> {
  const options = await getFilePathOptions(relativePath)
  return options.baseDir
    ? exists(options.path, { baseDir: options.baseDir })
    : exists(options.path)
}

async function readNote(relativePath: string): Promise<string | null> {
  if (!relativePath || !await pathExists(relativePath)) return null
  const options = await getFilePathOptions(relativePath)
  return options.baseDir
    ? readTextFile(options.path, { baseDir: options.baseDir })
    : readTextFile(options.path)
}

async function writeNewNote(relativePath: string, content: string): Promise<void> {
  if (await writeSelfHostedWorkspaceText(relativePath, content)) return

  const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
  const workspace = await getWorkspacePath()
  if (parent && !await pathExists(parent)) {
    const dir = await getFilePathOptions(parent)
    if (workspace.isCustom) await mkdir(dir.path, { recursive: true })
    else await mkdir(dir.path, { baseDir: dir.baseDir, recursive: true })
  }
  const file = await getFilePathOptions(relativePath)
  if (workspace.isCustom) await writeTextFile(file.path, content)
  else await writeTextFile(file.path, content, { baseDir: file.baseDir })
}

async function revealInFileTree(relativePath: string): Promise<void> {
  const article = useArticleStore.getState()
  if (!article.reconcileLocalFile(relativePath, true)) {
    const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
    if (parent) await article.loadCollapsibleFiles(parent, { force: true, skipRemoteSync: true })
    else await article.loadFileTree({ skipRemoteSync: true })
    useArticleStore.getState().reconcileLocalFile(relativePath, true)
  }
  await useArticleStore.getState().ensurePathExpanded(relativePath)
}

export interface OpenDailyNoteResult {
  path: string
  created: boolean
}

/** 打開指定日期（預設今天）的日記；檔案不存在時才建立。 */
export async function openDailyNote(now: Date = new Date()): Promise<OpenDailyNoteResult> {
  const settingsStore = useDailySettingsStore.getState()
  await settingsStore.initSettings()
  const settings = useDailySettingsStore.getState()

  const path = dailyNotePath(now, settings.dailyFolder, settings.dailyPattern)
  let created = false
  if (!await pathExists(path)) {
    const content = await buildDailyNoteContent({
      now,
      notePath: path,
      templates: {
        defaultTemplate: settings.defaultTemplate,
        weekdayTemplates: settings.weekdayTemplates,
      },
      readNote,
    })
    // 讀模板期間可能已被 Obsidian 或同步建立：再確認一次，絕不覆蓋
    if (!await pathExists(path)) {
      await writeNewNote(path, content)
      created = true
    }
  }

  await revealInFileTree(path)
  await useArticleStore.getState().setActiveFilePath(path)
  return { path, created }
}
