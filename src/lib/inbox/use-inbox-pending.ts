'use client'

// Fork（UI 一致性）：Inbox 待整理數 = 還沒整理的記錄 + Inbox 資料夾裡的筆記。
// 左側欄徽章與首頁「Inbox 有 N 則待整理」用同一個算法，數字才對得上。
import { useMemo } from 'react'

import useDailySettingsStore from '@/stores/daily-settings'
import useInboxStore, { selectUnprocessedRecords } from '@/stores/inbox'
import useVaultIndexStore from '@/stores/vault-index'

export function inboxFolderPrefix(inboxFolder: string): string {
  return `${inboxFolder.replace(/^\/+|\/+$/g, '')}/`
}

export function useInboxPendingCount(): number {
  const records = useInboxStore(state => state.records)
  const processed = useInboxStore(state => state.processed)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const inboxFolder = useDailySettingsStore(state => state.inboxFolder)
  return useMemo(() => {
    const prefix = inboxFolderPrefix(inboxFolder)
    let folderNotes = 0
    for (const path of notes.keys()) if (path.startsWith(prefix)) folderNotes++
    return selectUnprocessedRecords({ records, processed }).length + folderNotes
  }, [records, processed, notes, revision, inboxFolder]) // eslint-disable-line react-hooks/exhaustive-deps
}
