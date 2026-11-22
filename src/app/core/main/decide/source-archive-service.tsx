'use client'

// Fork（almanac ALMNC-54.1，AC#6）：不採用的資料源 30 天後自動封存（只在 V3）。
// 開 App 時掃一次，之後開著每天掃一次；只設封存時間、不刪除，封存的仍留在資料源分頁的「不採用」裡、搜尋得到。
// 掃描與排程邏輯在 lib/v3-model/archive-sweep.ts（有測試），這裡只是接上資料庫。
import { useEffect } from 'react'
import { useUiV3 } from '@/lib/fork-ui'

export function SourceArchiveService() {
  const v3 = useUiV3()
  useEffect(() => {
    if (!v3) return
    let scheduler: { stop: () => void } | undefined
    let active = true
    void Promise.all([import('@/lib/v3-model/archive-sweep'), import('@/db/v3-sources'), import('@/lib/workbench/actions')]).then(([sweep, db, actions]) => {
      if (!active) return
      const created = sweep.createArchiveScheduler({
        sweep: () => db.archiveDueRejectedSources(Date.now()),
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
        onArchived: () => void actions.refreshSources(),
      })
      scheduler = created
      void created.start()
    }).catch(error => console.debug('[archive] scheduler unavailable', error))
    return () => {
      active = false
      scheduler?.stop()
    }
  }, [v3])
  return null
}
