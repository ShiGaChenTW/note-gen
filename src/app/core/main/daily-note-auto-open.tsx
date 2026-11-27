'use client'

// Fork (D1): open (and create if missing) today's daily note once per app launch,
// after the file tree is ready so it lands on top of the restored tabs.
import { useEffect } from 'react'
import useArticleStore, { currentFileActivationIntent, isDeferredFileActivationCurrent } from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import { openDailyNote } from '@/lib/daily/open-daily-note'

let openedThisLaunch = false

export function DailyNoteAutoOpen() {
  const fileTreeInitialized = useArticleStore(state => state.fileTreeInitialized)

  useEffect(() => {
    if (!fileTreeInitialized || openedThisLaunch) return
    openedThisLaunch = true
    // A file the user opens while today's note is being prepared wins over this automatic open.
    const activationIntent = currentFileActivationIntent()
    void (async () => {
      await useDailySettingsStore.getState().initSettings()
      if (!useDailySettingsStore.getState().openOnLaunch) return
      await openDailyNote(new Date(), {
        shouldActivate: () => isDeferredFileActivationCurrent(activationIntent),
      })
    })().catch(error => console.error('Failed to open daily note on launch:', error))
  }, [fileTreeInitialized])

  return null
}
