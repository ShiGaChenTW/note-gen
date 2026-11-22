'use client'

// Fork（almanac ALMNC-57.2）：RSS 排程（只在 V3）。App 開著時：啟動時抓一次所有沒暫停的訂閱，之後每 6 小時抓到期的；
// 新文章存成外部資料源（等你決定）。抓不到只記在訂閱上，不跳通知。
import { useEffect } from 'react'
import { useUiV3 } from '@/lib/fork-ui'

export function RssService() {
  const v3 = useUiV3()
  useEffect(() => {
    if (!v3) return
    let active = true
    let stop: (() => void) | undefined
    void import('@/lib/source-import/rss-store').then(async ({ default: useRssStore, rssScheduler }) => {
      await useRssStore.getState().load()
      if (!active) return
      const scheduler = rssScheduler()
      stop = () => scheduler.stop()
      await scheduler.start()
    }).catch(error => console.debug('[rss] scheduler unavailable', error))
    return () => {
      active = false
      stop?.()
    }
  }, [v3])
  return null
}
