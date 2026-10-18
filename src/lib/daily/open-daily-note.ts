/**
 * 今日筆記（D1）：不存在就依模板建立，已存在絕不覆蓋。
 * I/O 層；內容產生在 daily-note-content.ts，檔案讀寫在 note-io.ts。
 */

import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import { dailyNotePath } from './format'
import { buildDailyNoteContent } from './daily-note-content'
import { noteExists, readNote, revealInFileTree, writeNote } from './note-io'

export interface OpenDailyNoteResult {
  path: string
  created: boolean
}

/** 確保指定日期（預設今天）的日記存在，不切換分頁。 */
export async function ensureDailyNote(now: Date = new Date()): Promise<OpenDailyNoteResult> {
  await useDailySettingsStore.getState().initSettings()
  const settings = useDailySettingsStore.getState()

  const path = dailyNotePath(now, settings.dailyFolder, settings.dailyPattern)
  if (await noteExists(path)) return { path, created: false }

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
  if (await noteExists(path)) return { path, created: false }
  await writeNote(path, content)
  await revealInFileTree(path)
  return { path, created: true }
}

/** 打開指定日期（預設今天）的日記；檔案不存在時才建立。 */
export async function openDailyNote(now: Date = new Date()): Promise<OpenDailyNoteResult> {
  const result = await ensureDailyNote(now)
  if (!result.created) await revealInFileTree(result.path)
  await useArticleStore.getState().setActiveFilePath(result.path)
  return result
}
