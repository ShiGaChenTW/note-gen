'use client'

// Fork（almanac ALMNC-69.7）：MOC 檔變動 → 重新解析 → 由正式收錄重建筆記 frontmatter 的 domains（只在 V3）。
// 時機沿用 69.5 的掃描補號（IdScanService）：筆記庫索引準備好（App 啟動）與每次檔案變動（索引 revision 變了）後，
// 再等 1.5 秒沒有新變動才跑；重建本身寫檔造成的變動會再觸發一次，第二次沒有變化就不寫。
// 邏輯在 lib/moc（純函式有測試）；超過 3 個領域的筆記記進 stores/moc，由工作台出卡請 Scott 選。
// Fork（almanac ALMNC-69.10）：重建前先比對 App 外改過的 MOC（lib/moc/reconcile-runtime）：同一次去抖動＝同一批事件；
// 直接生效的記成 ops，要整批檢查的不生效、出工作台卡；斷鏈、格式壞了、整批檢查用 toast 提醒。
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { useUiV3 } from '@/lib/fork-ui'
import useMocStore from '@/stores/moc'
import useVaultIndexStore from '@/stores/vault-index'

const REBUILD_DEBOUNCE_MS = 1500

export function MocRebuildService() {
  const v3 = useUiV3()
  const t = useTranslations('mocReconcile')
  const translate = useRef(t)
  translate.current = t
  const ready = useVaultIndexStore(state => state.status === 'ready')
  const revision = useVaultIndexStore(state => state.revision)
  const running = useRef(false)
  const again = useRef(false)

  useEffect(() => {
    if (!v3 || !ready) return
    const run = async (): Promise<void> => {
      if (running.current) {
        again.current = true
        return
      }
      running.current = true
      try {
        try {
          const { runMocReconcile } = await import('@/lib/moc/reconcile-runtime')
          const { notices } = await runMocReconcile()
          for (const notice of notices) toast({ title: translate.current(notice.key, notice.values) })
        } catch (error) {
          console.error('[moc] Obsidian 手動編輯比對失敗：', error)
        }
        const { runMocRebuild } = await import('@/lib/moc/runtime')
        const result = await runMocRebuild()
        if (result?.skipped.length) console.warn('[moc] domains 沒寫成（下次再處理）：', result.skipped)
      } catch (error) {
        console.error('[moc] 重建失敗：', error)
        useMocStore.getState().markLoaded()
      } finally {
        running.current = false
        if (again.current) {
          again.current = false
          void run()
        }
      }
    }
    const timer = setTimeout(() => void run(), REBUILD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [v3, ready, revision])

  return null
}
