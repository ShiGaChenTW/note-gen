'use client'

// Fork（#31）：首頁卡片登記表。每張卡片可以放進版型 D 的多個位置（頂部列、主欄、右欄）；
// 開關與排序以卡片為單位。新卡片（#32 起）加在這裡即可。
import type { ComponentType } from 'react'
import type { HomeCardMeta, HomeSlot } from '@/lib/home/cards'
import { TodayAgenda, TodayFocus, TodayFootprint, TodayTasks, TodayWeekNav } from '../today/today-page'

export interface HomeCardDef extends HomeCardMeta {
  /** messages 的 home.cards.<key>。 */
  slots: Partial<Record<HomeSlot, ComponentType>>
}

function ScheduleMain() {
  return (
    <>
      <TodayFocus />
      <TodayTasks />
    </>
  )
}

function ScheduleSide() {
  return (
    <>
      <TodayAgenda />
      <TodayFootprint />
    </>
  )
}

export const HOME_CARDS: HomeCardDef[] = [
  { key: 'schedule', defaultOn: true, slots: { header: TodayWeekNav, main: ScheduleMain, side: ScheduleSide } },
]
