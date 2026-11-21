// Fork（almanac ALMNC-47）：今日簡報的對外入口。
//   buildBriefing(date)   讀各來源 → assembleBriefing（純函式）→ 跟輸出格式無關的 Briefing
//   commitSent(briefing)  真的送出後才呼叫（ALMNC-50 區網下載成功／ALMNC-52 立即推送）
// EPUB（ALMNC-48）與休眠畫面（ALMNC-49）都讀 buildBriefing 的結果。
import type { ReadLaterItem } from '@/lib/eink/read-later'
import type { BriefingSection } from '@/lib/eink/settings'
import { dateKey } from '@/lib/today/today-model'
import { assembleBriefing, type BriefingInputs, type PinSnapshot, type ScheduleSourceData } from './assemble'
import { readBriefingLog } from './commit'
import {
  defaultPinsSource, defaultReadLaterSource, defaultReportSource, defaultScheduleSource, defaultWorkbenchSource, type Source,
} from './sources'
import type { BriefingLog } from './state'
import { loadBriefingTexts, type BriefingTexts } from './texts'
import { fetchWeather } from './weather'
import type { Briefing, ReportSummary, SourceResult, WeatherData, WorkbenchData } from './types'

export { assembleBriefing } from './assemble'
export { commitSent } from './commit'
export type * from './types'

export interface BriefingSources {
  settings: () => Promise<{ sections: readonly BriefingSection[], weatherCity: string }>
  privateItems: () => Promise<readonly string[]>
  schedule: Source<ScheduleSourceData>
  weather: (city: string, date: Date) => Promise<SourceResult<WeatherData>>
  pins: Source<PinSnapshot[]>
  readLater: Source<ReadLaterItem[]>
  report: Source<ReportSummary>
  workbench: Source<WorkbenchData>
  log: () => Promise<BriefingLog>
}

async function einkState() {
  const { default: useEinkStore } = await import('@/stores/eink')
  await useEinkStore.getState().init()
  return useEinkStore.getState()
}

export function defaultBriefingSources(): BriefingSources {
  return {
    settings: async () => (await einkState()).settings,
    privateItems: async () => (await einkState()).privateItems,
    schedule: defaultScheduleSource(),
    weather: (city, date) => fetchWeather(city, dateKey(date)),
    pins: defaultPinsSource(),
    readLater: defaultReadLaterSource(),
    report: defaultReportSource(),
    workbench: defaultWorkbenchSource(),
    log: readBriefingLog,
  }
}

/** 某個來源連 SourceResult 都回不出來（丟錯）時當成 error，不擋其他章。 */
async function guard<T>(run: () => Promise<SourceResult<T>>): Promise<SourceResult<T>> {
  try {
    return await run()
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' }
  }
}

/** 讀好 date 那天各來源的資料（只讀，不改任何狀態）。章節沒勾的來源不讀（例如不抓天氣）。 */
export async function loadBriefingInputs(date: Date, sources: BriefingSources = defaultBriefingSources()): Promise<BriefingInputs> {
  const settings = await sources.settings()
  const on = new Set(settings.sections)
  const skip = <T>(): Promise<SourceResult<T>> => Promise.resolve({ status: 'empty' })
  const [privateItems, schedule, weather, pins, readLater, report, workbench, log] = await Promise.all([
    sources.privateItems().catch(() => [] as readonly string[]),
    on.has('schedule') ? guard(() => sources.schedule(date)) : skip<ScheduleSourceData>(),
    on.has('schedule') ? guard(() => sources.weather(settings.weatherCity, date)) : skip<WeatherData>(),
    on.has('pinned') || on.has('review') ? guard(() => sources.pins(date)) : skip<PinSnapshot[]>(),
    on.has('articles') ? guard(() => sources.readLater(date)) : skip<ReadLaterItem[]>(),
    on.has('report') ? guard(() => sources.report(date)) : skip<ReportSummary>(),
    on.has('workbench') ? guard(() => sources.workbench(date)) : skip<WorkbenchData>(),
    sources.log().catch((): BriefingLog => ({ reviewShown: {} })),
  ])
  return { settings: { sections: settings.sections }, privateItems, schedule, weather, pins, readLater, report, workbench, log }
}

/** 產生 date 那天的今日簡報。不更新任何「已送」狀態。 */
export async function buildBriefing(
  date: Date,
  sources: BriefingSources = defaultBriefingSources(),
  texts?: BriefingTexts,
): Promise<Briefing> {
  const [inputs, resolvedTexts] = await Promise.all([loadBriefingInputs(date, sources), texts ? Promise.resolve(texts) : loadBriefingTexts()])
  return assembleBriefing(date, inputs, resolvedTexts)
}

/**
 * 開發預覽（不進 production）：在開發者工具執行 `await window.__almanacBriefingPreview()` 看今天的簡報資料。
 * 只讀，不會把文章或回顧卡標成已送。
 */
export function registerBriefingPreview(): void {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return
  ;(window as unknown as { __almanacBriefingPreview?: (date?: string) => Promise<Briefing> }).__almanacBriefingPreview = (date?: string) => (
    buildBriefing(date ? new Date(`${date}T12:00:00`) : new Date())
  )
}
