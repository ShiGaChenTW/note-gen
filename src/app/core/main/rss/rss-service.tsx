'use client'

// Fork（almanac ALMNC-57.2）：RSS 排程（只在 V3）。App 開著時：啟動時抓一次所有沒暫停的訂閱，之後每 6 小時抓到期的；
// 新文章存成外部資料源（等你決定）。抓不到只記在訂閱上，不跳通知。
// Fork（almanac ALMNC-85.2，第 8 節 1A）：開了 V3 同步時，自動排程只在主力裝置跑；其他裝置手動「立即更新」照樣可以。
// 主力裝置改了（設定頁或同步收到 devices.json）就重新判斷，該停的停、該開的開。
import { useEffect } from 'react'
import { useUiV3 } from '@/lib/fork-ui'
import emitter from '@/lib/emitter'

export function RssService() {
  const v3 = useUiV3()
  useEffect(() => {
    if (!v3) return
    let active = true
    let stop: (() => void) | undefined
    let checking: Promise<void> = Promise.resolve()

    const evaluate = () => {
      checking = checking.then(async () => {
        const [{ default: useRssStore, rssScheduler }, { isThisDeviceAlmanacPrimary }] = await Promise.all([
          import('@/lib/source-import/rss-store'),
          import('@/lib/almanac-sync/runtime'),
        ])
        await useRssStore.getState().load()
        if (!active) return
        const scheduler = rssScheduler()
        const primary = await isThisDeviceAlmanacPrimary().catch(() => true)
        if (!active) return
        if (primary && !scheduler.started) {
          stop = () => scheduler.stop()
          await scheduler.start()
        } else if (!primary && scheduler.started) {
          scheduler.stop()
          stop = undefined
        }
      }).catch(error => console.debug('[rss] scheduler unavailable', error))
    }

    evaluate()
    emitter.on('almanac-sync-state-changed', evaluate)
    return () => {
      active = false
      emitter.off('almanac-sync-state-changed', evaluate)
      stop?.()
    }
  }, [v3])
  return null
}
