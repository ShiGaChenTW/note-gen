// Fork（almanac ALMNC-56.7，RPT-2026-009 P06）：今日日誌的輪詢。
// 以前每分鐘讀一次、內容沒變也 set，連帶重算提案、側欄徽章與今天頁；不在工作台也照跑。
// 現在：內容相同就不 set（sameJournal）；只在工作台開著、視窗沒隱藏時輪詢，回到前景時立刻補讀一次。
import { useEffect } from 'react'
import type { JournalSnapshot } from './project'

export const JOURNAL_POLL_MS = 60_000

/** 兩份日誌快照內容是否相同（null 只和 null 相同）。 */
export function sameJournal(a: JournalSnapshot | null, b: JournalSnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.before === b.before && a.section === b.section && a.fileMissing === b.fileMissing && a.today === b.today
    && a.path === b.path && a.workspace === b.workspace
}

/** 要不要輪詢：工作台開著、視窗沒隱藏。 */
export function shouldPollJournal(state: { active: boolean, hidden: boolean }): boolean {
  return state.active && !state.hidden
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

/** active（V3 且工作台開著）時每分鐘讀一次；視窗隱藏時停掉，回到前景補讀一次再繼續。 */
export function useJournalPolling(active: boolean, refresh: () => unknown): void {
  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
    const start = () => {
      if (timer === undefined) timer = setInterval(() => void refresh(), JOURNAL_POLL_MS)
    }
    const sync = (catchUp: boolean) => {
      if (!shouldPollJournal({ active, hidden: documentHidden() })) return stop()
      if (catchUp) void refresh()
      start()
    }
    const onVisibility = () => sync(true)
    sync(false)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, refresh])
}
