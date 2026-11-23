'use client'

// Fork（almanac ALMNC-69.5）：掃描補號與斷鏈修復（只在 V3）。
// 筆記庫索引準備好（App 啟動）與每次檔案變動（索引 revision 變了；監看器本身已有 300ms 去抖動）後，
// 再等 1.5 秒沒有新變動才掃一次；掃描本身寫檔造成的變動會再觸發一次，第二次沒有動作。
// 邏輯在 lib/v3-model/id-scan.ts（純函式、有測試）與 id-scan-runner.ts（I/O）；這裡只排程與通知。
// Fork（almanac ALMNC-71）：toast 之外，每次修復也寫一筆「系統修復」活動紀錄（lib/v3-model/id-scan-activity.ts），設定頁可回查。
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { useUiV3 } from '@/lib/fork-ui'
import useVaultIndexStore from '@/stores/vault-index'
import type { ScanAction } from '@/lib/v3-model/id-scan'

const SCAN_DEBOUNCE_MS = 1500

/** 寫系統修復紀錄；寫不進去只記 console，不擋 toast 與下次掃描。 */
async function logRepairs(actions: readonly ScanAction[], logged: Set<string>): Promise<void> {
  if (!actions.length) return
  try {
    const [{ repairActivityEntries }, { appendActivity }] = await Promise.all([import('@/lib/v3-model/id-scan-activity'), import('@/db/agent-memory')])
    const { entries, onceKeys } = repairActivityEntries(actions, logged)
    for (const key of onceKeys) logged.add(key)
    for (const entry of entries) await appendActivity('system', entry)
  } catch (error) {
    console.error('[id-scan] 系統修復紀錄寫入失敗：', error)
  }
}

export function IdScanService() {
  const v3 = useUiV3()
  const t = useTranslations('idScan')
  const ready = useVaultIndexStore(state => state.status === 'ready')
  const revision = useVaultIndexStore(state => state.revision)
  const running = useRef(false)
  const again = useRef(false)
  const notified = useRef(new Set<string>())
  const logged = useRef(new Set<string>())
  const translate = useRef(t)
  translate.current = t

  useEffect(() => {
    if (!v3 || !ready) return
    const run = async (): Promise<void> => {
      if (running.current) {
        again.current = true
        return
      }
      running.current = true
      try {
        const [{ runIdScan }, { scanNotices, summarizeScan }] = await Promise.all([import('@/lib/v3-model/id-scan-runner'), import('@/lib/v3-model/id-scan')])
        const result = await runIdScan()
        if (!result) return
        await logRepairs(result.plan.actions, logged.current)
        for (const notice of scanNotices(summarizeScan(result.plan.actions))) {
          if (notice.onceKey) {
            if (notified.current.has(notice.onceKey)) continue
            notified.current.add(notice.onceKey)
          }
          toast({ title: translate.current(notice.key, notice.values) })
        }
      } catch (error) {
        console.error('[id-scan] 掃描失敗：', error)
      } finally {
        running.current = false
        if (again.current) {
          again.current = false
          void run()
        }
      }
    }
    const timer = setTimeout(() => void run(), SCAN_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [v3, ready, revision])

  return null
}
