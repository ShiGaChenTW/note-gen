'use client'

// Fork: background services for the main window, mounted once from page.tsx
// so upstream files only carry a single mount point.
import { useEffect } from 'react'
import useSettingStore from '@/stores/setting'
import { startVaultIndex, type VaultIndexHandle } from '@/lib/vault-index/service'
import { DailyNoteAutoOpen } from './daily-note-auto-open'

/** F3: keep the vault index in sync with the active workspace. */
function VaultIndexService() {
  const workspacePath = useSettingStore(state => state.workspacePath)

  useEffect(() => {
    let handle: VaultIndexHandle | null = null
    let disposed = false
    void startVaultIndex(workspacePath)
      .then(started => {
        if (disposed) started.stop()
        else handle = started
      })
      .catch(error => console.error('[vault-index] failed to start:', error))
    return () => {
      disposed = true
      handle?.stop()
    }
  }, [workspacePath])

  return null
}

export function ForkServices() {
  return (
    <>
      <VaultIndexService />
      <DailyNoteAutoOpen />
    </>
  )
}
