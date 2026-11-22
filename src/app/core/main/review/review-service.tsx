'use client'

// Fork（almanac ALMNC-54.13）：G 自我優化的排程——V3 主視窗準備好、回到前景、每 30 分鐘檢查一次；
// 到了 Agent 設定區設定的頻率（預設每週）才真的跑一輪（lib/review/runtime.ts runScheduledReview）。
import { useEffect } from 'react'
import { useUiModeStore, useUiV3 } from '@/lib/fork-ui'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'

const CHECK_MS = 30 * 60_000

async function check() {
  try {
    const [{ isTauri }, { getCurrentWindow }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/window')])
    if (!isTauri() || getCurrentWindow().label !== 'main') return
    const { runScheduledReview } = await import('@/lib/review/runtime')
    await runScheduledReview()
  } catch {
    // App 可以在沒有筆記庫、模型或行事曆的情況下啟動。
  }
}

export function ReviewService() {
  const v3 = useUiV3()
  const ready = useSettingsHydrationStore(state => state.status === 'ready')
  const uiReady = useUiModeStore(state => state.loaded)
  const workspace = useSettingStore(state => state.workspacePath)

  useEffect(() => {
    if (!v3 || !ready || !uiReady) return
    const run = () => void check()
    // 等索引與名單載入後再第一次檢查。
    const first = window.setTimeout(run, 60_000)
    window.addEventListener('focus', run)
    const timer = window.setInterval(run, CHECK_MS)
    return () => {
      window.clearTimeout(first)
      window.removeEventListener('focus', run)
      window.clearInterval(timer)
    }
  }, [v3, ready, uiReady, workspace])

  return null
}
