'use client'

// Fork（almanac ALMNC-85.2）：V3 同步套用遠端資料後，重讀資料源分頁；主力裝置另外叫指揮官分析新到的待分析資料源（設計 6 風險 6、第 8 節 1A）。
import { useEffect } from 'react'

export function AlmanacSyncReloadService() {
  useEffect(() => {
    let stop: (() => void) | undefined
    let active = true
    void import('@/lib/almanac-sync/tables/app').then(({ installAlmanacSyncReloaders }) => {
      if (active) stop = installAlmanacSyncReloaders()
    }).catch(error => console.debug('[almanac-sync] reloaders unavailable', error))
    return () => {
      active = false
      stop?.()
    }
  }, [])
  return null
}
