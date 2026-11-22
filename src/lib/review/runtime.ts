// Fork（almanac ALMNC-54.13）：把回顧排程接到 App 裡既有的工具——角色名單與記憶、編輯器 AI（指揮官同一個模型）、
// 網路搜尋（研究員）、筆記庫索引（領域、任務、紀錄筆記、到期的知識筆記）、macOS 行事曆、提案清單（14 天沒決定的）、
// Agent 設定區（工作筆記、目前脈絡、活動紀錄）與衝突偵測（lib/cleanup/runtime.ts）。
// 這個檔案需要 Tauri 才跑得起來，所以不寫單元測試；流程本身的測試用 runner.test.ts 的假依賴。
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, loadMessagesWithFallback, normalizeLocale } from '@/i18n/config'
import { notesDueForConfirm, ymd } from '@/lib/cleanup/interval'
import type { RosterAgent } from '@/lib/commander/types'
import { parseV3Note } from '@/lib/v3-model/note'
import type { AuditLabels } from './audit'
import type { ScheduleLabels } from './action-review'
import type { DomainDigest } from './research'
import type { ReviewRunDeps } from './runner'
import { defaultReviewSettingsStore } from './settings'
import type { WeeklyLabels } from './weekly'

async function translator() {
  let locale = DEFAULT_LOCALE
  let messages: AbstractIntlMessages = {}
  try {
    locale = normalizeLocale(typeof window === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY))
    messages = await loadMessagesWithFallback(locale)
  } catch (error) {
    console.warn('[review] messages unavailable', error)
  }
  return createTranslator({ locale, messages, namespace: 'review' })
}

export async function reviewLabels(): Promise<ReviewRunDeps['labels']> {
  const t = await translator()
  const weekly: WeeklyLabels = {
    period: values => t('period', values),
    title: values => t('title', values),
    origin: values => (values.agent ? t('origin', values) : t('originSystem')),
    tag: t('tag'),
    sections: {
      actions: t('sections.actions'), records: t('sections.records'), research: t('sections.research'), experts: t('sections.experts'),
      due: t('sections.due'), stale: t('sections.stale'), audit: t('sections.audit'), attached: t('sections.attached'),
    },
    completed: values => t('completed', values),
    overdue: values => t('overdue', values),
    procrastinated: values => t('procrastinated', values),
    time: values => t('time', values),
    minutes: values => t('minutes', values),
    researchItem: values => t('researchItem', values),
    researchUnavailable: values => t('researchUnavailable', values),
    researchNothing: values => t('researchNothing', values),
    expertItem: values => (values.agent ? t('expertItem', values) : t('expertItemNoName', values)),
    dueItem: values => t('dueItem', values),
    staleItem: values => t('staleItem', values),
    auditItem: values => t('auditItem', values),
    auditMemory: memory => t(`auditMemory.${memory}`),
    attached: values => t('attached', values),
  }
  const schedule: ScheduleLabels = {
    title: values => t('schedule.title', values),
    body: values => t('schedule.body', values),
  }
  const audit: AuditLabels = {
    workNotesTitle: values => t('audit.workNotesTitle', values),
    contextTitle: values => t('audit.contextTitle', values),
    line: values => t('audit.line', values),
  }
  return { weekly, schedule, audit }
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function titleOf(path: string, frontmatter: Record<string, unknown> | null): string {
  const title = frontmatter?.title
  return typeof title === 'string' && title.trim() ? title.trim() : (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

export async function createDefaultReviewDeps(): Promise<ReviewRunDeps> {
  const [
    { listAgentSettings }, memory, { listDomains }, { askCollectModel }, { ROLE_INSTRUCTIONS }, { default: useVaultIndexStore, selectAllTasks },
    cleanup, labels, settings,
  ] = await Promise.all([
    import('@/db/agents'),
    import('@/db/agent-memory'),
    import('@/db/v3-domains'),
    import('@/lib/collect/ai'),
    import('@/lib/agents/instructions'),
    import('@/stores/vault-index'),
    import('@/lib/cleanup/runtime'),
    reviewLabels(),
    defaultReviewSettingsStore(),
  ])
  const check = await cleanup.createDefaultCheckDeps()
  const notes = () => Array.from(useVaultIndexStore.getState().notes.values())
  const roster = async (): Promise<RosterAgent[]> => listAgentSettings()
  return {
    settings,
    roster,
    agentPrompt: async agent => [ROLE_INSTRUCTIONS[agent.role], await memory.loadAgentMemoryPrompt(agent).catch(() => '')].filter(Boolean).join('\n\n'),
    ask: prompt => askCollectModel(prompt, undefined, { silent: true }),
    // 研究員的外部查詢：既有的網路搜尋。沒開時每題會標成查詢失敗，題目仍列在每週回顧裡。
    lookup: cleanup.defaultLookup,
    digests: async (): Promise<DomainDigest[]> => {
      const domains = await listDomains()
      const all = notes()
      return domains.map(domain => ({
        domainId: domain.id,
        name: domain.name,
        notes: all.filter(note => note.frontmatter?.type === 'knowledge' && strings(note.frontmatter.domains).includes(domain.id)).map(note => ({
          path: note.path,
          title: titleOf(note.path, note.frontmatter),
          ...(typeof note.frontmatter?.summary === 'string' ? { summary: note.frontmatter.summary } : {}),
          ...(typeof note.frontmatter?.status === 'string' ? { status: note.frontmatter.status } : {}),
          ...(typeof note.frontmatter?.lastConfirmed === 'string' ? { lastConfirmed: note.frontmatter.lastConfirmed } : {}),
        })),
      }))
    },
    tasks: async () => selectAllTasks(useVaultIndexStore.getState()),
    events: async range => {
      const { invokeCalendar } = await import('@/lib/calendar/calendar')
      const response = await invokeCalendar('calendar_week', { start: range.start.getTime(), end: range.end.getTime() })
      return response.access === 'granted' ? response.events : []
    },
    records: async range => {
      const start = ymd(range.start)
      const end = ymd(range.end)
      return notes().filter(note => {
        if (note.frontmatter?.type !== 'record') return false
        const date = note.frontmatter.date instanceof Date ? ymd(note.frontmatter.date) : typeof note.frontmatter.date === 'string' ? note.frontmatter.date : note.mtime ? ymd(new Date(note.mtime)) : ''
        return date >= start && date <= end
      }).map(note => ({ path: note.path, title: titleOf(note.path, note.frontmatter) }))
    },
    dueNotes: async (today, until) => notesDueForConfirm(notes(), await cleanup.loadReconfirmIntervals(), today, { until }),
    stale: async now => {
      const [{ projectProposals }, { staleProposals, waitingDays }, { default: useCollectStore }, { useAgentTaskStore }, { useJobs }, { default: useTrail }] = await Promise.all([
        import('@/lib/decide/project'), import('@/lib/proposals/trail'), import('@/stores/collect'), import('@/lib/agent-tasks'), import('@/lib/jobs'), import('@/stores/proposals'),
      ])
      await useCollectStore.getState().hydrate()
      const pending = projectProposals({
        items: useCollectStore.getState().items, tasks: useAgentTaskStore.getState().tasks, journal: null, jobs: useJobs.getState().jobs, trail: useTrail.getState().trail,
      })
      return staleProposals(pending, now).map(item => ({ key: item.key, title: item.summary || item.title, days: waitingDays(item.at, now) }))
    },
    memory: async () => {
      const agents = await roster()
      const workNotes = await Promise.all(agents.map(async agent => ({
        agent: { id: agent.id, name: agent.name, role: agent.role, ...(agent.domain ? { domain: agent.domain } : {}) },
        content: (await memory.getAgentMemory(agent)).workNotes.content,
      })))
      const { projects, weeklyFocus, people } = await memory.getSharedContext()
      const activity = (await memory.listActivity({ limit: 200 })).map(entry => ({ id: entry.id, note: entry.note ?? '' }))
      return { workNotes, context: { projects, weeklyFocus, people }, activity }
    },
    auditNotes: async () => {
      const { readNote } = await import('@/lib/daily/note-io')
      const out = []
      for (const note of notes().filter(entry => ['knowledge', 'record', 'project'].includes(String(entry.frontmatter?.type))).slice(0, 400)) {
        const raw = await readNote(note.path).catch(() => null)
        if (raw) out.push({ path: note.path, title: titleOf(note.path, note.frontmatter), body: parseV3Note(raw).body })
      }
      return out
    },
    check,
    submit: check.submit,
    labels,
    commanderName: check.commanderName,
  }
}

let active = false

/** App 定期叫這個：頻率到了才跑一輪（同一時間只跑一輪）。 */
export async function runScheduledReview(): Promise<void> {
  if (active) return
  active = true
  try {
    const { maybeRunReview } = await import('./runner')
    const summary = await maybeRunReview(await createDefaultReviewDeps())
    if (summary.errors.length) console.warn('[review] finished with errors:', summary.errors)
  } catch (error) {
    console.warn('[review] scheduled review skipped:', error)
  } finally {
    active = false
  }
}

/** Agent 設定區的「現在執行一次」。 */
export async function runReviewNow(): Promise<void> {
  if (active) return
  active = true
  try {
    const { runReview } = await import('./runner')
    await runReview(await createDefaultReviewDeps())
  } finally {
    active = false
  }
}
