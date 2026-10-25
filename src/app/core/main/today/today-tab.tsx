'use client'

// Fork (D2)：今日頁原本是編輯器裡的虛擬分頁（blank://fork-today）。
// #31 起內容移到首頁的「日程」卡片；這裡只留舊分頁的辨識與轉址提示，
// 讓之前存下來的版面還原時不會壞。
import { useTranslations } from 'next-intl'
import { House } from 'lucide-react'
import { Button } from '@/components/ui/button'
import useHomeStore from '@/stores/home'

export const TODAY_TAB_ID = 'fork-today'
export const TODAY_TAB_PATH = 'blank://fork-today'

export function isTodayTab(tab: { path: string }): boolean {
  return tab.path === TODAY_TAB_PATH
}

/** 從任何地方（狀態列、指令）要求看今日：打開首頁。 */
export function openTodayTab() {
  useHomeStore.getState().show()
}

/** 舊版留下的今日分頁：提示內容已移到首頁。 */
export function TodayMovedNotice() {
  const t = useTranslations('home')
  return (
    <div className="grid h-full w-full place-items-center bg-card">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <House className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('todayMoved')}</p>
        <Button onClick={openTodayTab}>{t('open')}</Button>
      </div>
    </div>
  )
}
