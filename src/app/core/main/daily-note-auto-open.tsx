'use client'

// Fork (D1): open (and create if missing) today's daily note once per app launch,
// after the file tree is ready so it lands on top of the restored tabs.
import { useEffect } from 'react'
import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import { openDailyNote } from '@/lib/daily/open-daily-note'

let openedThisLaunch = false

export function DailyNoteAutoOpen() {
  const fileTreeInitialized = useArticleStore(state => state.fileTreeInitialized)

  useEffect(() => {
    if (!fileTreeInitialized || openedThisLaunch) return
    openedThisLaunch = true
    void (async () => {
      await useDailySettingsStore.getState().initSettings()
      if (!useDailySettingsStore.getState().openOnLaunch) return
      await openDailyNote()
    })().catch(error => console.error('Failed to open daily note on launch:', error))
  }, [fileTreeInitialized])

  return null
}
