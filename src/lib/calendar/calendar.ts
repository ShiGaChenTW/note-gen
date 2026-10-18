/**
 * macOS 行事曆（EventKit）讀取，D2 今日頁使用。
 * Rust 端指令在 src-tauri/src/calendar.rs，透過 Swift 小工具 notegen-calendar 讀取事件。
 * 只讀不寫：今日頁只顯示事件，不會修改行事曆。
 */

import { useCallback, useEffect, useState } from 'react'
import type { CalendarEvent } from '@/lib/today/today-model'

export type CalendarAccess = 'granted' | 'denied' | 'notDetermined' | 'restricted' | 'unavailable'

interface CalendarResponse {
  access: CalendarAccess
  events: Array<{
    id: string
    title: string
    start: number
    end: number
    allDay: boolean
    calendar: string
  }>
}

async function invokeCalendar(command: 'calendar_events' | 'calendar_request_access', args: Record<string, unknown> = {}): Promise<CalendarResponse> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<CalendarResponse>(command, args)
  } catch (error) {
    // 非 macOS、未打包 Swift 小工具、或瀏覽器預覽時
    console.warn('[calendar] unavailable:', error)
    return { access: 'unavailable', events: [] }
  }
}

function dayRange(day: Date): { start: number, end: number } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  return { start, end: start + 86_400_000 }
}

export async function loadCalendarEvents(day: Date): Promise<CalendarResponse> {
  return invokeCalendar('calendar_events', dayRange(day))
}

export async function requestCalendarAccess(day: Date): Promise<CalendarResponse> {
  return invokeCalendar('calendar_request_access', dayRange(day))
}

const REFRESH_MS = 5 * 60_000

/** 今天的行事曆事件；每 5 分鐘與切回視窗時重新讀取。 */
export function useCalendarEvents(day: Date) {
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
  const [state, setState] = useState<{ access: CalendarAccess | 'loading', events: CalendarEvent[] }>({ access: 'loading', events: [] })

  const load = useCallback(async (request = false) => {
    const target = new Date(day)
    const response = request ? await requestCalendarAccess(target) : await loadCalendarEvents(target)
    setState({ access: response.access, events: response.events })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return { ...state, requestAccess: () => load(true), reload: () => load() }
}
