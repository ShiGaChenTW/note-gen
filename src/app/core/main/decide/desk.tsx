'use client'

// Fork（almanac ALMNC-54.8）：檯面——獨立的專注模式（不和清單並排）。三欄：素材、工作稿、協助。
// 打開時協助欄自動開一段「處理」對話（指揮官＋負責的專家，#112 的 process 標籤），對話面板沿用右側欄那一份（ChatDock 搬過來）。
// 檯面的結構操作直接生效。工作稿存成筆記時標上「親手寫的」。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { Domain } from '@/lib/v3-model/domain'
import { agentDisplayName } from '@/lib/agents/display'
import { loadDeskMaterials, mergeDeskNotes, runDeskOp, saveDeskNote, startProcessConversation } from '@/lib/workbench/actions'
import { deskHeading, initialDraft, STRUCTURAL_OPS, type DeskMaterial, type StructuralOp } from '@/lib/workbench/desk'
import { cn } from '@/lib/utils'
import useWorkbenchStore from '@/stores/workbench'
import { Button } from '@/components/ui/button'
import { V3_BUTTON_SHAPE } from '@/components/v3/button-shape'
import { SectionLabel } from '@/components/v3/section-label'
import { PageHeader } from '../page-ui'
import { BTN, ButtonKbd } from './review-card'

type OpKind = typeof STRUCTURAL_OPS[number]

function MaterialOps({ material, materials, domains, disabled, onPending, onDone }: {
  material: DeskMaterial
  materials: readonly DeskMaterial[]
  domains: readonly Domain[]
  disabled: boolean
  onPending: (pending: boolean) => void
  onDone: (path: string | undefined, op: OpKind, value: string) => Promise<void>
}) {
  const t = useTranslations('workbench.desk')
  const [op, setOp] = useState<OpKind | null>(null)
  const [value, setValue] = useState('')
  const linkTargets = materials.filter(entry => entry.path && entry.path !== material.path)

  async function apply() {
    if (disabled || !op || !value.trim() || !material.path) return
    onPending(true)
    const structural: StructuralOp = op === 'move' ? { op, path: material.path, folder: value }
      : op === 'tag' ? { op, path: material.path, tag: value }
        : op === 'link' ? { op, path: material.path, target: value }
          : { op, path: material.path, domainId: value }
    try {
      const result = await runDeskOp(structural)
      const label = op === 'link' ? (linkTargets.find(entry => entry.path === value)?.title ?? value)
        : op === 'assignDomain' ? (domains.find(domain => domain.id === value)?.name ?? value) : value.trim().replace(/^#/, '')
      await onDone(result.path, op, label)
      setOp(null)
      setValue('')
    } catch (error) {
      console.error('[workbench] desk op failed:', error)
      toast.error(String(error instanceof Error ? error.message : error))
    } finally {
      onPending(false)
    }
  }

  if (!material.path) return <p className="mt-1.5 text-xs text-faint">{t('notesOnly')}</p>
  return (
    <div className="mt-2" role="group" aria-label={t('ops.label')}>
      <div className="flex flex-wrap gap-1">
        {STRUCTURAL_OPS.map(kind => (
          <button key={kind} type="button" disabled={disabled} data-desk-op={kind} aria-pressed={op === kind} onClick={() => { setOp(op === kind ? null : kind); setValue('') }}
            className={cn('h-6 cursor-pointer rounded-(--r-kbd) px-1.5 text-xs text-muted-ink hover:bg-hover hover:text-ink', op === kind && 'bg-active text-ink')}>
            {t(`ops.${kind}`)}
          </button>
        ))}
      </div>
      {op && (
        <form className="mt-1.5 flex items-center gap-1.5" onSubmit={event => { event.preventDefault(); void apply() }}>
          {op === 'link' ? (
            <select value={value} onChange={event => setValue(event.target.value)} aria-label={t('ops.link')} className="h-7 min-w-0 flex-1 rounded-(--r-kbd) border border-line bg-bg px-1.5 text-xs">
              <option value="" />
              {linkTargets.map(entry => <option key={entry.id} value={entry.path}>{entry.title}</option>)}
            </select>
          ) : op === 'assignDomain' ? (
            <select value={value} onChange={event => setValue(event.target.value)} aria-label={t('ops.assignDomain')} className="h-7 min-w-0 flex-1 rounded-(--r-kbd) border border-line bg-bg px-1.5 text-xs">
              <option value="">{domains.length ? '' : t('ops.noDomains')}</option>
              {domains.map(domain => <option key={domain.id} value={domain.id}>{domain.name}</option>)}
            </select>
          ) : (
            <input value={value} onChange={event => setValue(event.target.value)} autoFocus aria-label={t(`ops.${op}`)}
              placeholder={op === 'move' ? t('ops.movePlaceholder') : t('ops.tagPlaceholder')}
              className="h-7 min-w-0 flex-1 rounded-(--r-kbd) border border-line bg-bg px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ink/60" />
          )}
          <button type="submit" disabled={disabled || !value.trim()} className={cn(BTN, 'h-7 px-2 text-xs')}>{t('ops.apply')}</button>
        </form>
      )}
    </div>
  )
}

function HelpColumn({ commanderName, snapshot }: { commanderName: string, snapshot: readonly DeskMaterial[] }) {
  const t = useTranslations('workbench.desk')
  const roles = useTranslations('agents.roles')
  const conversationId = useWorkbenchStore(state => state.desk.conversationId)
  const [experts, setExperts] = useState<Awaited<ReturnType<typeof startProcessConversation>>['experts']>([])
  const [failed, setFailed] = useState(false)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const pending = useRef<ReturnType<typeof startProcessConversation> | null>(null)
  const fallbackName = t('fallbackName')

  useEffect(() => {
    if (conversationId !== undefined) return
    let active = true
    pending.current ??= startProcessConversation(snapshot, fallbackName)
    void pending.current.then(({ id, experts }) => {
      if (!active) return
      setExperts(experts)
      useWorkbenchStore.getState().setDeskConversation(id)
    }).catch(error => {
      console.error('[workbench] process conversation failed:', error)
      if (active) setFailed(true)
    })
    return () => { active = false }
  }, [conversationId, fallbackName, snapshot])

  // 沿用右側欄的唯一對話面板。載入對話後才讓輸入框出現在協助欄。
  useEffect(() => {
    if (!host || conversationId === undefined) return
    let cancelled = false
    void Promise.all([import('@/stores/threads'), import('@/stores/chat')]).then(async ([threads, chat]) => {
      if (cancelled) return
      const state = chat.default.getState()
      if (state.currentConversationId !== conversationId) await state.switchConversation(conversationId)
      if (!cancelled) threads.default.getState().setChatHost(host)
    }).catch(error => {
      console.error('[workbench] cannot show desk conversation:', error)
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
      void import('@/stores/threads').then(threads => {
        if (threads.default.getState().chatHost === host) threads.default.getState().setChatHost(null)
      }).catch(() => undefined)
    }
  }, [host, conversationId])

  const names = [commanderName, ...experts.map(expert => agentDisplayName(expert, (key, values) => roles(key, values)))]
  return (
    <div className="flex min-h-0 flex-col" data-testid="desk-help">
      <SectionLabel as="h2" className="mb-1 px-5 pt-5">{t('help')}</SectionLabel>
      <p className="px-5 pb-2 text-xs text-muted-ink">
        {failed ? t('helpFailed') : conversationId === undefined ? t('helpStarting') : t('helpHint', { name: names.join(' / ') })}
      </p>
      <div ref={setHost} className="min-h-0 flex-1" data-conversation={conversationId ?? ''} />
    </div>
  )
}

export function Desk({ commanderName }: { commanderName: string }) {
  const t = useTranslations('workbench.desk')
  const materials = useWorkbenchStore(state => state.desk.materials)
  const setMaterials = useWorkbenchStore(state => state.setDeskMaterials)
  const closeDesk = useWorkbenchStore(state => state.closeDesk)
  const [draft, setDraft] = useState(() => initialDraft(materials))
  const [domains, setDomains] = useState<Domain[]>([])
  const [saving, setSaving] = useState(false)
  const heading = deskHeading(materials)

  const initialMaterials = useRef(materials)
  const loading = useRef<ReturnType<typeof loadDeskMaterials> | null>(null)
  const [applying, setApplying] = useState(false)
  const [snapshot, setSnapshot] = useState<DeskMaterial[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const noteMaterials = materials.filter(material => material.path)
  const missingNote = noteMaterials.some(material => material.noteRaw === undefined)

  useEffect(() => {
    let active = true
    loading.current ??= loadDeskMaterials(initialMaterials.current)
    void loading.current.then(loaded => {
      if (!active) return
      setMaterials(loaded)
      setSnapshot(loaded)
      setDraft(initialDraft(loaded))
    }).catch(error => {
      console.error('[workbench] cannot load desk materials:', error)
      if (active) setLoadFailed(true)
    })
    return () => { active = false }
  }, [setMaterials])

  useEffect(() => {
    void import('@/db/v3-domains').then(db => db.listDomains()).then(setDomains).catch(() => undefined)
  }, [])

  const onOpDone = useCallback(async (material: DeskMaterial, path: string | undefined, op: OpKind, value: string) => {
    const current = useWorkbenchStore.getState().desk.materials
    if (path && current.includes(material)) {
      const moved = { ...material, id: path, path, noteRaw: undefined }
      setMaterials(current.map(entry => entry === material ? moved : entry))
      const [updated] = await loadDeskMaterials([moved])
      const latest = useWorkbenchStore.getState().desk.materials
      if (latest.includes(moved)) setMaterials(latest.map(entry => entry === moved ? updated : entry))
    }
    toast(t(`done.${op}`, { value }))
  }, [setMaterials, t])

  async function save(merge = false) {
    if (saving || applying || !snapshot || !draft.body.trim()) return
    if (merge && (missingNote || !window.confirm(t('mergeConfirm', { count: noteMaterials.length })))) return
    setSaving(true)
    try {
      const handTag = t('handTag')
      const fallbackName = t('fallbackName')
      if (merge) {
        const path = await mergeDeskNotes(draft, materials, { handTag, fallbackName, reason: t('mergeReason') })
        toast(t('merged', { path }))
        if (useWorkbenchStore.getState().desk.materials === materials) closeDesk()
      } else {
        const path = await saveDeskNote(draft, materials, handTag, fallbackName)
        toast(t('saved', { path }))
      }
    } catch (error) {
      console.error('[workbench] desk save failed:', error)
      toast.error(merge ? t('mergeFailed') : String(error instanceof Error ? error.message : error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-card" aria-label={t('title')} data-testid="desk">
      {/* Fork（almanac ALMNC-56.6，V05）：檯面頁首也用共用的 PageHeader（標題 20px／600，和其他 V3 頁同高），動作用 Button。 */}
      <PageHeader
        title={t('title')}
        subtitle={<span className="block truncate">{heading.more ? t('heading', { first: heading.first, count: heading.more }) : heading.first}</span>}
        onBack={closeDesk}
        actions={(
          <>
            <Button variant="ghost" onClick={closeDesk} data-testid="desk-back" className={cn(V3_BUTTON_SHAPE, 'gap-2 text-ui-compact font-normal text-muted-ink hover:bg-hover hover:text-ink')}>
              <ArrowLeft className="size-4" aria-hidden />{t('back')}<ButtonKbd>Esc</ButtonKbd>
            </Button>
            {noteMaterials.length >= 2 && (
              <Button variant="outline" className={cn(V3_BUTTON_SHAPE, 'px-3')} data-desk-op="merge"
                disabled={saving || applying || missingNote || !draft.body.trim()} onClick={() => void save(true)}>{t('ops.merge')}</Button>
            )}
            <Button className={cn(V3_BUTTON_SHAPE, 'px-3')} disabled={saving || applying || !snapshot || !draft.body.trim()} onClick={() => void save()} data-testid="desk-save">{t('save')}</Button>
          </>
        )}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_1.25fr_1fr] lg:overflow-hidden">
        <div className="min-h-0 border-r border-line-soft px-5 py-5 lg:overflow-y-auto" data-testid="desk-materials">
          <SectionLabel as="h2" className="mb-3">{t('materials', { count: materials.length })}</SectionLabel>
          {materials.length === 0 && <p className="text-ui-compact text-muted-ink">{t('empty')}</p>}
          {(loadFailed || (snapshot && missingNote)) && <p className="mb-3 text-xs text-muted-ink" role="status">{t('materialsUnavailable')}</p>}
          {materials.map(material => (
            <div key={material.id} className="mb-3 rounded-(--r) border border-line-soft px-3 py-2.5" data-testid="desk-material">
              <b className="block text-ui-compact font-semibold text-ink">{material.title}</b>
              <p className="mt-1 line-clamp-4 text-xs leading-5 whitespace-pre-wrap text-muted-ink">{material.text}</p>
              <MaterialOps material={material} materials={materials} domains={domains} disabled={saving || applying || !snapshot} onPending={setApplying} onDone={(path, op, value) => onOpDone(material, path, op, value)} />
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-col border-r border-line-soft px-6 py-5 lg:overflow-y-auto" data-testid="desk-draft">
          <SectionLabel as="h2" className="mb-3">{t('draft')}</SectionLabel>
          <input value={draft.title} disabled={!snapshot || saving} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder={t('draftTitle')} aria-label={t('draftTitle')}
            className="w-full bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-faint" />
          <textarea value={draft.body} disabled={!snapshot || saving} onChange={event => setDraft({ ...draft, body: event.target.value })} placeholder={t('draftBody')} aria-label={t('draft')}
            className="mt-3 min-h-[40vh] w-full flex-1 resize-none bg-transparent text-sm leading-7 text-note-ink outline-none placeholder:text-faint" />
        </div>
        {snapshot ? <HelpColumn commanderName={commanderName} snapshot={snapshot} /> : (
          <div className="flex min-h-0 flex-col" data-testid="desk-help">
            <SectionLabel as="h2" className="mb-1 px-5 pt-5">{t('help')}</SectionLabel>
            <p className="px-5 pb-2 text-xs text-muted-ink">{loadFailed ? t('helpFailed') : t('helpStarting')}</p>
          </div>
        )}
      </div>
    </section>
  )
}
