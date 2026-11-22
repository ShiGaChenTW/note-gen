// Fork（almanac ALMNC-47）：今日簡報的各個來源（adapter）。每個來源都可以換掉（測試或之後換資料來源），
// 一律回傳 SourceResult（有資料／沒資料／沒授權／出錯），不丟錯：一個來源壞掉不擋其他章。
// 預設實作才碰 app 的 store 與檔案（動態 import，測試不會載入 Tauri）。
import { parseDailyNote } from '@/lib/daily/daily-note'
import { privacyKey } from '@/lib/eink/privacy'
import type { EinkPin } from '@/lib/eink/pins'
import type { ReadLaterItem } from '@/lib/eink/read-later'
import { latestReport, type ReportData } from '@/lib/knowledge-report/report'
import type { CalendarResponse } from '@/lib/calendar/calendar'
import { dateKey, groupTasks } from '@/lib/today/today-model'
import type { TaskRef } from '@/lib/vault-index/index-core'
import { localDay } from '@/lib/week/dates'
import { noteTitle, stripFrontmatter, type PinSnapshot, type ScheduleSourceData } from './assemble'
import type { ReportSummary, SourceResult, WorkbenchData } from './types'

export type Source<T> = (date: Date) => Promise<SourceResult<T>>

function errorResult(error: unknown): { status: 'error', message: string } {
  return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' }
}

function at(day: Date, hours: number, minutes: number): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes).getTime()
}

// ---------- 今天行程 ----------

export interface ScheduleDeps {
  /** 行事曆（EventKit，calendar_events 指令）；沒授權時 access 不是 granted */
  loadEvents: (date: Date) => Promise<CalendarResponse>
  /** 索引裡的任務（取今天到期、有時間的） */
  tasks: () => Promise<readonly TaskRef[]> | readonly TaskRef[]
  /** 當天日誌全文（取時段）；沒有日誌回 null */
  dailyNote: (date: Date) => Promise<string | null>
}

const ANCHOR_RANGE_RE = /^(\d{1,2}):(\d{2})\s*(?:[-–~]\s*(\d{1,2}):(\d{2}))?/

/**
 * 今天行程＝行事曆事件＋有時間的今日任務＋日誌時段（GLOSSARY「行程」）。鍵用 privacyKey，私人標記才對得上。
 * 行事曆沒授權：仍列出任務與時段（calendar: 'denied'）；三者都沒有時回 denied。
 * 行事曆無法使用（不在 Tauri、EventKit 小工具出錯）：calendar: 'unavailable'。
 * 任務或日誌讀不到只少那一部分，不算整個來源失敗。
 */
export function createScheduleSource(deps: ScheduleDeps): Source<ScheduleSourceData> {
  return async date => {
    try {
      const day = dateKey(date)
      const dayStart = localDay(date).getTime()
      const dayEnd = localDay(date, 1).getTime()
      const response = await deps.loadEvents(date).catch((): CalendarResponse => ({ access: 'unavailable', events: [] }))
      const calendar: ScheduleSourceData['calendar'] = response.access === 'granted' ? 'granted' : response.access === 'unavailable' ? 'unavailable' : 'denied'
      const items: ScheduleSourceData['items'] = []

      for (const event of calendar === 'granted' ? response.events : []) {
        if (event.end <= dayStart || event.start >= dayEnd) continue
        items.push({
          key: privacyKey({ kind: 'calendar', key: `cal:${event.id}`, title: event.title }, day),
          kind: 'calendar',
          title: event.title,
          start: event.allDay ? dayStart : event.start,
          end: event.allDay ? 0 : event.end,
          allDay: event.allDay,
          source: event.calendar,
        })
      }

      const tasks = await Promise.resolve(deps.tasks()).catch(() => [] as readonly TaskRef[])
      for (const task of tasks) {
        if (task.done || task.due !== day || !task.time) continue
        const [h, m] = task.time.split(':').map(Number)
        items.push({
          key: privacyKey({ kind: 'task', key: '', title: task.title, task: { path: task.path } }, day),
          kind: 'task',
          title: task.title,
          start: at(date, h, m),
          end: 0,
          allDay: false,
          source: task.path,
        })
      }

      const journal = await deps.dailyNote(date).catch(() => null)
      for (const anchor of journal ? parseDailyNote(journal).anchors : []) {
        if (!anchor.time) continue
        const [h, m] = anchor.time.split(':').map(Number)
        const range = anchor.raw.replace(/^\s*[-*+]\s*(?:\[.\]\s*)?/, '').match(ANCHOR_RANGE_RE)
        items.push({
          key: privacyKey({ kind: 'anchor', key: '', title: anchor.text }, day),
          kind: 'anchor',
          title: anchor.text,
          start: at(date, h, m),
          end: range?.[3] ? at(date, Number(range[3]), Number(range[4])) : 0,
          allDay: false,
          source: '',
        })
      }

      if (calendar === 'denied' && items.length === 0) return { status: 'denied' }
      return { status: 'ok', data: { calendar, items } }
    } catch (error) {
      return errorResult(error)
    }
  }
}

// ---------- 釘選資料（也是每日回顧卡的來源） ----------

export interface PinsDeps {
  pins: () => Promise<readonly EinkPin[]>
  /** 讀工作區相對路徑的文字內容；檔案不在回 null */
  read: (path: string) => Promise<string | null>
}

const TEXT_FILE_RE = /\.(?:md|markdown|txt)$/i

/** 釘選清單＋每則的內容。只讀文字檔；讀不到的那則 content 為 null（章節裡只列標題），不影響其他則。 */
export function createPinsSource(deps: PinsDeps): Source<PinSnapshot[]> {
  return async () => {
    try {
      const pins = await deps.pins()
      if (pins.length === 0) return { status: 'empty' }
      const data = await Promise.all(pins.map(async (pin): Promise<PinSnapshot> => {
        const raw = TEXT_FILE_RE.test(pin.path) ? await deps.read(pin.path).catch(() => null) : null
        return { pin, title: noteTitle(pin.path, raw), content: raw === null ? null : stripFrontmatter(raw).trim() }
      }))
      return { status: 'ok', data }
    } catch (error) {
      return errorResult(error)
    }
  }
}

// ---------- 每日精選文章 ----------

export function createReadLaterSource(deps: { items: () => Promise<readonly ReadLaterItem[]> }): Source<ReadLaterItem[]> {
  return async () => {
    try {
      const items = await deps.items()
      return items.length === 0 ? { status: 'empty' } : { status: 'ok', data: [...items] }
    } catch (error) {
      return errorResult(error)
    }
  }
}

// ---------- 知識報告 ----------

export function toReportSummary(path: string, report: ReportData): ReportSummary {
  return {
    path,
    period: report.period,
    generated: report.generated,
    topics: report.topics.map(topic => ({ name: topic.name, level: topic.level, score: topic.score, prevLevel: topic.prevLevel })),
    suggestions: report.suggestions.filter(item => item.status === 'open').map(item => item.text),
    stats: { ...report.stats },
  }
}

/** 最新一期知識報告（沿用 ReportService 產出、存在筆記 frontmatter 的報告）。沒有任何一期回 empty。 */
export function createReportSource(deps: { reports: () => Promise<Array<{ path: string, report: ReportData }>> }): Source<ReportSummary> {
  return async () => {
    try {
      const latest = latestReport(await deps.reports())
      return latest ? { status: 'ok', data: toReportSummary(latest.path, latest.report) } : { status: 'empty' }
    } catch (error) {
      return errorResult(error)
    }
  }
}

// ---------- 工作台摘要 ----------

export interface DecisionLike {
  key: string
  title: string
  when: string
  at: number
}

/**
 * 工作台摘要的來源介面。現在的 dev 還沒有 V3 工作台（ALMNC-54），先用既有的：
 *   要決定＝等你定清單（projectDecisions）
 *   要完成＝逾期＋今天到期、還沒做的任務（groupTasks）
 * 工作台上線後只要換掉這個 adapter，組裝與輸出都不用改。
 */
export function createWorkbenchSource(deps: {
  decisions: () => Promise<readonly DecisionLike[]>
  tasks: () => Promise<readonly TaskRef[]> | readonly TaskRef[]
}): Source<WorkbenchData> {
  return async date => {
    try {
      const [decisions, tasks] = await Promise.all([deps.decisions(), Promise.resolve(deps.tasks())])
      const groups = groupTasks(tasks, date, 1)
      const toItem = (task: TaskRef, overdue: boolean) => ({ path: task.path, line: task.line, title: task.title, due: task.due, overdue })
      const data: WorkbenchData = {
        decide: decisions.map(item => ({ key: item.key, title: item.title, when: item.when, at: item.at })),
        complete: [...groups.overdue.map(task => toItem(task, true)), ...(groups.upcoming[0]?.tasks ?? []).map(task => toItem(task, false))],
      }
      return { status: 'ok', data }
    } catch (error) {
      return errorResult(error)
    }
  }
}

// ---------- 預設實作（app 內） ----------

async function vaultTasks(): Promise<readonly TaskRef[]> {
  const { default: useVaultIndexStore, selectAllTasks } = await import('@/stores/vault-index')
  return selectAllTasks(useVaultIndexStore.getState())
}

async function readWorkspaceNote(path: string): Promise<string | null> {
  const { readNote } = await import('@/lib/daily/note-io')
  return readNote(path)
}

export function defaultScheduleSource(): Source<ScheduleSourceData> {
  return createScheduleSource({
    loadEvents: async date => (await import('@/lib/calendar/calendar')).loadCalendarEvents(date),
    tasks: vaultTasks,
    dailyNote: async date => {
      const { default: useDailySettingsStore } = await import('@/stores/daily-settings')
      const { dailyNotePath } = await import('@/lib/daily/format')
      await useDailySettingsStore.getState().initSettings()
      const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
      return readWorkspaceNote(dailyNotePath(date, dailyFolder, dailyPattern))
    },
  })
}

export function defaultPinsSource(): Source<PinSnapshot[]> {
  return createPinsSource({
    pins: async () => {
      const { default: useEinkStore } = await import('@/stores/eink')
      await useEinkStore.getState().init()
      return useEinkStore.getState().pins
    },
    read: readWorkspaceNote,
  })
}

export function defaultReadLaterSource(): Source<ReadLaterItem[]> {
  return createReadLaterSource({
    items: async () => {
      const { default: useReadLaterStore } = await import('@/stores/read-later')
      await useReadLaterStore.getState().init()
      return useReadLaterStore.getState().items
    },
  })
}

export function defaultReportSource(): Source<ReportSummary> {
  return createReportSource({
    reports: async () => {
      const { listReports } = await import('@/lib/knowledge-report/generate')
      const { default: useVaultIndexStore } = await import('@/stores/vault-index')
      return listReports(useVaultIndexStore.getState().notes.values())
    },
  })
}

export function defaultWorkbenchSource(): Source<WorkbenchData> {
  return createWorkbenchSource({
    decisions: async () => {
      const [{ projectDecisions }, { useAgentTaskStore }, { useJobs }, collect, decide, setting] = await Promise.all([
        import('@/lib/decide/project'),
        import('@/lib/agent-tasks'),
        import('@/lib/jobs'),
        import('@/stores/collect'),
        import('@/stores/decide'),
        import('@/stores/setting'),
      ])
      return projectDecisions({
        items: collect.default.getState().items,
        tasks: useAgentTaskStore.getState().tasks,
        journal: decide.default.getState().journal,
        jobs: useJobs.getState().jobs,
        workspace: setting.default.getState().workspacePath,
      })
    },
    tasks: vaultTasks,
  })
}
