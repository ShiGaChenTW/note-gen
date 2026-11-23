'use client'

// Fork（almanac ALMNC-54.3）：Agent 設定區——每個角色的 soul.md、rules.md、工作筆記，共用工作記憶（目前脈絡、活動紀錄）
// 和 Scott 的偏好。設定頁上的操作都是 Scott 本人，所以寫入時 actor 一律是 'scott'。只在 V3 顯示（由 AgentSettings 控制）。
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  getAgentMemory, getScottPreferences, getSharedContext, listActivity, saveScottPreferences, saveSharedContext,
  writeAgentMemory, type AgentMemoryView,
} from '@/db/agent-memory'
import {
  activityActors, filterActivityByActor, formatContextLines, parseContextLines, validateSharedContext,
  type ActivityEntry, type ContextValidationError, type MemoryKind,
} from '@/lib/agent-memory'
import { agentRoleLabel } from '@/lib/agents/display'
import type { AgentSettings as SavedAgent } from '@/lib/agents/settings'
import { Button } from '@/components/ui/button'
import { UndoCompareCard } from '@/components/ops/undo-compare-card'
import { opUiStates, undoBatch, undoOp, type OpUiState } from '@/lib/ops/runtime'
import { runDomainUndo, type DomainUndoChoice, type ExpertUndoOutcome, type ProposalExpert } from '@/lib/ops/domain-undo'
import { askDomainUndo } from '@/lib/ops/domain-undo-ask'
import { proposalExpertForTarget, removeProposalExpert } from '@/lib/ops/domain-undo-runtime'
import type { CompareFile } from '@/lib/ops/types'
import { SettingSection } from '../components/setting-base'

const field = 'w-full rounded-md border border-line bg-bg px-3 py-2 text-ink'
const textarea = `${field} min-h-32 font-mono text-xs`
const ACTIVITY_LIMIT = 50

type Section = MemoryKind | 'context' | 'preferences' | 'activity'
type Notice = { section: Section, key: 'saved' | 'saveError' | ContextErrorKey | UndoNoticeKey, expert?: ExpertUndoOutcome }
type UndoNoticeKey = 'undoDone' | 'undoExpired' | 'undoFailed'
/** ALMNC-69.9：復原一筆（op）或撤回這次整理（batch）。 */
type UndoTarget = { entryId: number, mode: 'op', opId: string } | { entryId: number, mode: 'batch', opId: string, batchId: string }
/** ALMNC-72：撤回成立領域提案時已經問過的選擇（比較卡「仍要復原」再跑時沿用，不再問）。 */
type DomainPrior = { choice: DomainUndoChoice, expert: ProposalExpert | null }
type ContextErrorKey = 'tooManyProjects' | 'tooManyFocus' | 'tooManyPeople' | 'titleRequired' | 'titleTooLong'

const CONTEXT_ERRORS: Record<ContextValidationError, ContextErrorKey> = {
  TOO_MANY_PROJECTS: 'tooManyProjects',
  TOO_MANY_FOCUS: 'tooManyFocus',
  TOO_MANY_PEOPLE: 'tooManyPeople',
  TITLE_REQUIRED: 'titleRequired',
  TITLE_TOO_LONG: 'titleTooLong',
}

const MEMORY_FIELDS: Array<{ kind: MemoryKind, view: keyof AgentMemoryView, label: 'soul' | 'rules' | 'workNotes', hint: 'soulHint' | 'rulesHint' | 'workNotesHint' }> = [
  { kind: 'soul', view: 'soul', label: 'soul', hint: 'soulHint' },
  { kind: 'rules', view: 'rules', label: 'rules', hint: 'rulesHint' },
  { kind: 'work_notes', view: 'workNotes', label: 'workNotes', hint: 'workNotesHint' },
]

interface ContextDraft { projects: string, weeklyFocus: string, people: string }

export function AgentMemorySettings({ agents, onAgentsChanged }: { agents: SavedAgent[], onAgentsChanged?: () => void }) {
  const t = useTranslations('agents.memory')
  const tDomainUndo = useTranslations('ops.domainUndo')
  const tRoles = useTranslations('agents.roles')
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? '')
  const [memory, setMemory] = useState<AgentMemoryView | null>(null)
  const [drafts, setDrafts] = useState<Record<MemoryKind, string>>({ soul: '', rules: '', work_notes: '' })
  const [context, setContext] = useState<ContextDraft | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  /** ALMNC-69.2：依發起的夥伴篩選；'' 是全部。 */
  const [actorFilter, setActorFilter] = useState('')
  const [preferences, setPreferences] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState<Section | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  /** ALMNC-69.9：活動紀錄對應的操作狀態（7 天內、未復原、同一批幾筆）。 */
  const [opStates, setOpStates] = useState<Map<string, OpUiState>>(new Map())
  const [undoing, setUndoing] = useState<number | null>(null)
  const [compare, setCompare] = useState<{ target: UndoTarget, files: CompareFile[], prior?: DomainPrior } | null>(null)

  const agent = agents.find(item => item.id === selectedId) ?? agents[0]

  useEffect(() => {
    let active = true
    Promise.all([getSharedContext(), listActivity({ limit: ACTIVITY_LIMIT }), getScottPreferences()]).then(([ctx, log, prefs]) => {
      if (!active) return
      setContext({ projects: formatContextLines(ctx.projects), weeklyFocus: formatContextLines(ctx.weeklyFocus), people: ctx.people.join('\n') })
      setActivity(log)
      setPreferences(prefs.content)
      void loadOpStates(log)
    }).catch(err => {
      console.error('[agents] memory load failed', err)
      if (active) setLoadError(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!agent) return
    let active = true
    setMemory(null)
    getAgentMemory(agent).then(view => {
      if (!active) return
      setMemory(view)
      setDrafts({ soul: view.soul.content, rules: view.rules.content, work_notes: view.workNotes.content })
    }).catch(err => {
      console.error('[agents] agent memory load failed', err)
      if (active) setLoadError(true)
    })
    return () => { active = false }
  }, [agent])

  async function loadOpStates(log: ActivityEntry[]) {
    const ids = [...new Set(log.flatMap(entry => entry.opId ? [entry.opId] : []))]
    try {
      setOpStates(await opUiStates(ids))
    } catch (err) {
      console.debug('[agents] op states unavailable', err)
    }
  }

  async function reloadActivity() {
    const log = await listActivity({ limit: ACTIVITY_LIMIT })
    setActivity(log)
    await loadOpStates(log)
  }

  async function undo(target: UndoTarget, force = false, prior?: DomainPrior) {
    setUndoing(target.entryId)
    setNotice(null)
    try {
      // ALMNC-72：成立領域提案新建了專家時，先問只撤回 MOC 還是一起撤回專家（取消就什麼都不動）。
      const expert = prior ? prior.expert : await proposalExpertForTarget(target.mode === 'batch' ? { opId: target.opId, batchId: target.batchId } : { opId: target.opId })
      const outcome = await runDomainUndo({
        expert,
        ...(prior ? { choice: prior.choice } : {}),
        ask: askDomainUndo,
        undo: () => target.mode === 'batch' ? undoBatch(target.batchId, { force }) : undoOp(target.opId, { force }),
        succeeded: result => result.status === 'undone',
        removeExpert: removeProposalExpert,
      })
      if (outcome.status === 'cancelled') return
      const result = outcome.result
      if (result.status === 'conflict') {
        setCompare({ target, files: result.files, prior: { choice: outcome.choice, expert } })
        return
      }
      setCompare(null)
      if (result.status === 'expired') setNotice({ section: 'activity', key: 'undoExpired' })
      else if (result.status === 'undone') setNotice({ section: 'activity', key: 'undoDone', ...(outcome.expert ? { expert: outcome.expert } : {}) })
      if (outcome.expert?.status === 'removed') onAgentsChanged?.()
      await reloadActivity()
    } catch (err) {
      console.error('[agents] undo failed', err)
      setNotice({ section: 'activity', key: 'undoFailed' })
    } finally {
      setUndoing(null)
    }
  }

  /** 這筆紀錄能做的復原：同一批還有 2 筆以上能復原就是「撤回這次整理」，否則復原這一筆。 */
  function undoTargetOf(entry: ActivityEntry): UndoTarget | null {
    if (!entry.opId || entry.action === 'undone') return null
    const state = opStates.get(entry.opId)
    if (state?.state !== 'undoable') return null
    return state.batchId && state.batchSize >= 2
      ? { entryId: entry.id, mode: 'batch', opId: entry.opId, batchId: state.batchId }
      : { entryId: entry.id, mode: 'op', opId: entry.opId }
  }

  async function run(section: Section, action: () => Promise<void>) {
    setSaving(section)
    setNotice(null)
    try {
      await action()
      setNotice({ section, key: 'saved' })
    } catch (err) {
      console.error('[agents] memory save failed', err)
      setNotice({ section, key: 'saveError' })
    } finally {
      setSaving(null)
    }
  }

  function saveMemory(kind: MemoryKind) {
    if (!agent) return
    void run(kind, async () => {
      await writeAgentMemory('scott', agent, kind, drafts[kind])
      setMemory(await getAgentMemory(agent))
    })
  }

  function saveContext() {
    if (!context) return
    const next = {
      projects: parseContextLines(context.projects),
      weeklyFocus: parseContextLines(context.weeklyFocus),
      people: context.people.split('\n'),
    }
    const checked = validateSharedContext(next)
    if (!checked.ok) {
      setNotice({ section: 'context', key: CONTEXT_ERRORS[checked.error] })
      return
    }
    void run('context', () => saveSharedContext('scott', checked.context))
  }

  const expertNotice = (outcome: ExpertUndoOutcome) => outcome.status === 'removed'
    ? tDomainUndo('expertRemoved', { name: outcome.expert.name })
    : tDomainUndo('expertKept', { name: outcome.expert.name, reasons: outcome.reasons.map(reason => tDomainUndo(`reasons.${reason}`)).join('；') })

  const status = (section: Section) => notice?.section === section && (
    <p role={notice.key === 'saved' ? 'status' : 'alert'} className="text-xs text-muted-foreground">
      {t(notice.key)}{notice.expert && ` ${expertNotice(notice.expert)}`}
    </p>
  )

  const actorName = (entry: Pick<ActivityEntry, 'actorId' | 'actorRole'>) => entry.actorRole === 'scott'
    ? t('scott')
    : agents.find(item => item.id === entry.actorId)?.name ?? entry.actorId

  const roleLabel = (entry: Pick<ActivityEntry, 'actorId' | 'actorRole'>) => {
    if (entry.actorRole === 'scott') return null
    const known = agents.find(item => item.id === entry.actorId)
    return agentRoleLabel(known ?? { role: entry.actorRole }, tRoles)
  }

  const actors = activityActors(activity)
  // 選的發起者已經不在紀錄裡（例如重新載入）就當成全部。
  const activeFilter = actors.some(actor => actor.actorId === actorFilter) ? actorFilter : ''
  const shownActivity = filterActivityByActor(activity, activeFilter)

  return (
    <SettingSection title={t('title')} desc={t('description')}>
      <div className="space-y-6 text-sm text-ink">
        {loadError && <p role="alert">{t('loadError')}</p>}

        {agent && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span>{t('agent')}</span>
              <select className={field} value={agent.id} onChange={event => { setSelectedId(event.target.value); setNotice(null) }}>
                {agents.map(item => (
                  <option key={item.id} value={item.id}>{item.name} · {agentRoleLabel(item, tRoles)}</option>
                ))}
              </select>
            </label>
            {memory && MEMORY_FIELDS.map(({ kind, view, label, hint }) => (
              <div key={kind} className="space-y-1 rounded-md border border-line bg-panel p-3">
                <label className="block space-y-1">
                  <span className="font-medium">{t(label)}</span>
                  <span className="block text-xs text-muted-foreground">{t(hint)}</span>
                  <textarea
                    className={textarea}
                    aria-label={t(label)}
                    value={drafts[kind]}
                    onChange={event => setDrafts({ ...drafts, [kind]: event.target.value })}
                  />
                </label>
                {memory[view].isTemplate && <p className="text-xs text-muted-foreground">{t('template')}</p>}
                <Button type="button" size="sm" variant="outline" disabled={saving !== null} onClick={() => saveMemory(kind)}>
                  {t(saving === kind ? 'saving' : 'save')}<span className="sr-only"> {t(label)}</span>
                </Button>
                {status(kind)}
              </div>
            ))}
          </div>
        )}

        {context && (
          <div className="space-y-2 rounded-md border border-line bg-panel p-3">
            <div className="font-medium">{t('context')}</div>
            <p className="text-xs text-muted-foreground">{t('contextHint')}</p>
            {(['projects', 'weeklyFocus', 'people'] as const).map(key => (
              <label key={key} className="block space-y-1">
                <span>{t(key)}</span>
                <textarea
                  className={`${field} min-h-20 text-xs`}
                  aria-label={t(key)}
                  value={context[key]}
                  onChange={event => setContext({ ...context, [key]: event.target.value })}
                />
              </label>
            ))}
            <Button type="button" size="sm" variant="outline" disabled={saving !== null} onClick={saveContext}>
              {t(saving === 'context' ? 'saving' : 'save')}<span className="sr-only"> {t('context')}</span>
            </Button>
            {status('context')}
          </div>
        )}

        {context && (
          <div className="space-y-2">
            <div className="font-medium">{t('activity')}</div>
            <p className="text-xs text-muted-foreground">{t('activityHint')} {t('undoWindowHint')}</p>
            {status('activity')}
            {compare && (
              <UndoCompareCard
                files={compare.files}
                busy={undoing !== null}
                onConfirm={() => void undo(compare.target, true, compare.prior)}
                onCancel={() => setCompare(null)}
              />
            )}
            {actors.length > 1 && (
              <label className="flex flex-wrap items-center gap-2 text-xs">
                <span>{t('activityFilter')}</span>
                <select className={`${field} w-auto py-1 text-xs`} value={activeFilter} onChange={event => setActorFilter(event.target.value)}>
                  <option value="">{t('activityFilterAll')}</option>
                  {actors.map(actor => (
                    <option key={actor.actorId} value={actor.actorId}>
                      {[actorName(actor), roleLabel(actor)].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">{t('activityFilterHint')}</span>
              </label>
            )}
            {shownActivity.length === 0
              ? <p className="text-muted-foreground">{t('activityEmpty')}</p>
              : (
                <ol aria-label={t('activity')} className="divide-y divide-line rounded-md border border-line bg-panel">
                  {shownActivity.map(entry => {
                    const target = undoTargetOf(entry)
                    const undone = entry.opId && opStates.get(entry.opId)?.state === 'undone' && entry.action !== 'undone'
                    return (
                    <li key={entry.id} className="space-y-0.5 px-3 py-2 text-xs">
                      <div className="flex flex-wrap gap-x-2">
                        <time dateTime={new Date(entry.at).toISOString()} className="text-muted-foreground">
                          {new Date(entry.at).toLocaleString()}
                        </time>
                        <span className="font-medium">{actorName(entry)}</span>
                        {roleLabel(entry) && <span className="text-muted-foreground">{roleLabel(entry)}</span>}
                        <span>{t(`actions.${entry.action}`)}</span>
                        <span className="break-all">{entry.targetLink}</span>
                        {entry.correctsId !== null && <span className="text-muted-foreground">{t('correctsEntry', { id: entry.correctsId })}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                        <span>
                          {entry.source.ref.startsWith('op:')
                            ? t('sourceDirect')
                            : t(entry.source.kind === 'proposal' ? 'sourceProposal' : 'sourceConversation', { ref: entry.source.ref })}
                          {entry.note && ` · ${entry.note}`}
                        </span>
                        {undone && <span>{t('undoneMark')}</span>}
                        {target && (
                          <Button
                            type="button" size="sm" variant="outline" className="h-6 px-2 text-xs"
                            disabled={undoing !== null}
                            onClick={() => void undo(target)}
                          >
                            {t(undoing === entry.id ? 'undoing' : target.mode === 'batch' ? 'undoBatch' : 'undo')}
                          </Button>
                        )}
                      </div>
                    </li>
                    )
                  })}
                </ol>
              )}
          </div>
        )}

        {preferences !== null && (
          <div className="space-y-1 rounded-md border border-line bg-panel p-3">
            <label className="block space-y-1">
              <span className="font-medium">{t('preferences')}</span>
              <span className="block text-xs text-muted-foreground">{t('preferencesHint')}</span>
              <textarea
                className={textarea}
                aria-label={t('preferences')}
                value={preferences}
                onChange={event => setPreferences(event.target.value)}
              />
            </label>
            <Button
              type="button" size="sm" variant="outline" disabled={saving !== null}
              onClick={() => void run('preferences', () => saveScottPreferences('scott', preferences))}
            >
              {t(saving === 'preferences' ? 'saving' : 'save')}<span className="sr-only"> {t('preferences')}</span>
            </Button>
            {status('preferences')}
          </div>
        )}
      </div>
    </SettingSection>
  )
}
