'use client'

// Fork（#31）：首頁卡片登記表。每張卡片可以放進版型 D 的多個位置（頂部列、主欄、右欄）；
// 開關與排序以卡片為單位。新卡片（#32 起）加在這裡即可。
import type { ComponentType } from 'react'
import type { HomeCardMeta, HomeSlot } from '@/lib/home/cards'
import { TodayAgenda, TodayFocus, TodayFootprint, TodayTasks, TodayWeekNav } from '../today/today-page'
import { CaptureBar } from './cards/capture-bar'
import { FootprintCard } from './cards/footprint-card'
import { RecentNotes } from './cards/recent-card'
import { SignalRulesSettings, useSignalNeeds } from './cards/signals-card'
import { TasksSection, useTaskNeeds } from './cards/tasks-card'

/** 「需要你處理」清單裡的一列。 */
export interface NeedItem {
  key: string
  /** 左側的分類字（待審草稿、提醒…）。 */
  label: string
  tone: 'primary' | 'destructive' | 'muted'
  text: string
  meta?: string
  action: string
  onAction: () => void
}

export interface HomeCardDef extends HomeCardMeta {
  /** messages 的 home.cards.<key>。 */
  slots: Partial<Record<HomeSlot, ComponentType>>
  /** 這張卡片放進「需要你處理」的項目；卡片關掉時不呼叫。 */
  useNeeds?: () => NeedItem[]
  /** 在「編輯首頁」裡顯示在這張卡片下方的設定。 */
  Settings?: ComponentType
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
  { key: 'capture', defaultOn: true, slots: { top: CaptureBar } },
  { key: 'signals', defaultOn: true, slots: {}, useNeeds: useSignalNeeds, Settings: SignalRulesSettings },
  { key: 'schedule', defaultOn: true, slots: { header: TodayWeekNav, main: ScheduleMain, side: ScheduleSide } },
  { key: 'tasks', defaultOn: true, slots: { main: TasksSection }, useNeeds: useTaskNeeds },
  { key: 'recent', defaultOn: true, slots: { side: RecentNotes } },
  { key: 'footprint', defaultOn: false, slots: { side: FootprintCard } },
]
