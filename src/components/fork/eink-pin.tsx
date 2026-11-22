'use client'

// Fork（almanac ALMNC-45）：「釘選到電子紙」的共用動作，給檔案樹、編輯器分頁與 ⌘K 用。
// 只在新介面（V3）回傳動作；classic 回傳 null，呼叫端就不畫選單項目。
import { useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useUiV3 } from '@/lib/fork-ui'
import { isPinned } from '@/lib/eink/pins'
import useEinkStore from '@/stores/eink'

export interface EinkPinAction {
  pinned: boolean
  label: string
  toggle: () => Promise<void>
}

/** 不在元件裡時用（⌘K 執行）：切換釘選並提示結果。 */
export async function toggleEinkPin(path: string, messages: { pinned: string, unpinned: string }): Promise<void> {
  const store = useEinkStore.getState()
  await store.init()
  const wasPinned = isPinned(useEinkStore.getState().pins, path)
  await store.togglePin(path)
  toast.success(wasPinned ? messages.unpinned : messages.pinned)
}

export function useEinkPinAction(path: string | null | undefined): EinkPinAction | null {
  const v3 = useUiV3()
  const t = useTranslations('eink')
  const init = useEinkStore(state => state.init)
  const pinned = useEinkStore(state => Boolean(path) && isPinned(state.pins, path!))
  useEffect(() => { if (v3) void init() }, [init, v3])
  const toggle = useCallback(async () => {
    if (path) await toggleEinkPin(path, { pinned: t('pinned'), unpinned: t('unpinned') })
  }, [path, t])
  if (!v3 || !path) return null
  return { pinned, label: t(pinned ? 'unpin' : 'pin'), toggle }
}
