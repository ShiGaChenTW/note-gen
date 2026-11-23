'use client'

// Fork（almanac ALMNC-14）：訊息下面的內嵌卡片。只在新介面（v3）顯示。
// 判斷都在 lib/threads/cards.ts 的 resolveThreadCard，這裡只畫。外觀依 redesign_v5：提案是虛線框、處理後變實線；開工卡是實線框。
import { useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, CalendarClock, FileText, ListTodo, LoaderCircle, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiV3 } from '@/lib/fork-ui'
import { resolveThreadCard, threadProposalKey, type CardAction, type DirectEditCardView, type KickoffCardView, type ProposalCardView, type ThreadCard } from '@/lib/threads/cards'
import { cn } from '@/lib/utils'
import { discussProposal } from '@/lib/proposals/actions'
import useChatStore from '@/stores/chat'
import useThreadsStore from '@/stores/threads'
import useCollectStore from '@/stores/collect'
import useProposalTrailStore from '@/stores/proposals'
import { DiscussForm } from '../decide/discuss-form'
import { NewNoteChanges } from '../decide/new-note-changes'

const KIND_ICON = { note: FileText, task: ListTodo, event: CalendarClock } as const

function ProposalCard({ view, onAction, onDiscuss, children }: { view: ProposalCardView, onAction: (action: CardAction) => void, onDiscuss: (note: string) => Promise<boolean>, children?: ReactNode }) {
  const t = useTranslations('threads.cards')
  const [discussing, setDiscussing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const discussRef = useRef<HTMLButtonElement>(null)

  /** 收起再次討論表單：焦點回到「再次討論」按鈕；按鈕已經消失（討論成功）就回到卡片本身，不掉到 body。 */
  function closeDiscuss() {
    setDiscussing(false)
    requestAnimationFrame(() => (discussRef.current ?? cardRef.current)?.focus())
  }
  const Icon = KIND_ICON[view.kind]
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      data-slot="thread-card"
      data-card="proposal"
      className={cn('rounded-(--r-kbd) border bg-bg p-3 text-sm outline-none', view.tone === 'pending' ? 'border-dashed border-line' : 'border-line-soft')}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-(--r-kbd) bg-hover px-1.5 py-0.5 text-ui-compact text-muted-ink">{t('proposal')}</span>
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-ink" />
        <span className={cn('min-w-0 flex-1 truncate font-medium text-ink', view.tone === 'muted' && 'text-muted-ink line-through')}>{view.title}</span>
        {view.when && <span className="shrink-0 text-xs text-muted-ink tabular-nums">{view.when}</span>}
      </div>
      {view.detail && <p className="mt-1.5 text-ui-compact text-muted-ink">{view.detail}</p>}
      {children}
      <div className="mt-2 flex items-center gap-1.5">
        {view.actions.includes('accept') && <Button size="sm" onClick={() => onAction('accept')}>{t('accept')}</Button>}
        {view.actions.includes('discuss') && <Button ref={discussRef} size="sm" variant="outline" aria-expanded={discussing} onClick={() => setDiscussing(open => !open)}>{t('discuss')}</Button>}
        {view.actions.includes('reject') && <Button size="sm" variant="ghost" onClick={() => onAction('reject')}>{t('reject')}</Button>}
        {view.actions.length === 0 && (
          <span className="flex items-center gap-1 text-ui-compact text-muted-ink">
            {view.tone === 'done' && <Check aria-hidden className="size-3.5" />}{t(view.statusKey)}
          </span>
        )}
        {view.actions.length > 0 && <span className="ml-auto text-ui-compact text-muted-ink">{t('alsoInInbox')}</span>}
      </div>
      {discussing && view.actions.includes('discuss') && (
        <DiscussForm
          className="mt-2"
          onCancel={closeDiscuss}
          onSubmit={async note => {
            // 失敗時表單留著、文字不清掉（ALMNC-56 重跑稽核）
            if (!await onDiscuss(note)) return false
            closeDiscuss()
            return true
          }}
        />
      )}
    </div>
  )
}

function KickoffCard({ view, onAction }: { view: KickoffCardView, onAction: (action: CardAction) => void }) {
  const t = useTranslations('threads.cards')
  return (
    <div data-slot="thread-card" data-card="kickoff-result" className="rounded-(--r-kbd) border border-line bg-bg p-3 text-sm">
      <div className="flex items-center gap-2">
        <ListTodo aria-hidden className="size-3.5 shrink-0 text-muted-ink" />
        <span className="text-ui-compact text-muted-ink">{t('kickoff')}</span>
        <span className="ml-auto text-ui-compact text-muted-ink">{t(view.stateKey)} · <span className="text-xs tabular-nums">{view.done}/{view.total}</span></span>
      </div>
      <p className="mt-1 font-medium text-ink">{view.title}</p>
      <div className="mt-2 flex gap-[3px]" aria-hidden>
        {view.tasks.map(task => (
          <i key={task.n} className={cn('h-[5px] flex-1 rounded-(--r-kbd) bg-active', view.showTaskStatus && task.status === 'run' && 'bg-faint', view.showTaskStatus && task.status === 'done' && 'bg-invert')} />
        ))}
      </div>
      <ol className="mt-2 flex flex-col gap-1">
        {view.tasks.map(task => (
          <li key={task.n} className="flex items-center gap-2 text-ui-compact">
            <span className="w-4 shrink-0 font-mono text-ui-numeric text-muted-ink">{task.n}</span>
            <span className="min-w-0 flex-1 truncate text-ink">
              {task.text}
              {task.dependsOn && task.dependsOn.length > 0 && <span className="text-muted-ink"> · {t('dependsOn', { list: task.dependsOn.join('、') })}</span>}
            </span>
            {task.owner && <span className="shrink-0 text-xs text-muted-ink">{task.owner}</span>}
            {view.showTaskStatus && (
              <span className="flex shrink-0 items-center gap-1 text-ui-compact text-muted-ink">
                {task.status === 'run' ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : task.status === 'done' ? <Check aria-hidden className="size-3" /> : null}
                {t(`task.${task.status}`)}
              </span>
            )}
          </li>
        ))}
      </ol>
      {view.acceptance.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-line-soft pt-2">
          {view.acceptance.map((item, index) => (
            <li key={index} className="flex items-center gap-2 text-ui-compact text-muted-ink">
              <span className={cn('grid size-3.5 shrink-0 place-items-center rounded-(--r-kbd) border border-line', item.status === 'ok' && 'border-invert bg-invert text-invert-ink')}>
                {item.status === 'ok' && <Check aria-hidden className="size-2.5" />}
              </span>
              <span>{item.text}</span>
              {item.status === 'look' && <span className="text-danger">· {t('needsLook')}</span>}
            </li>
          ))}
        </ul>
      )}
      {view.actions.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {view.actions.includes('start') && <Button size="sm" onClick={() => onAction('start')}>{t('start')}</Button>}
          {view.actions.includes('hold') && <Button size="sm" variant="outline" onClick={() => onAction('hold')}>{t('hold')}</Button>}
          {view.actions.includes('reopen') && <Button size="sm" variant="outline" onClick={() => onAction('reopen')}>{t('reopen')}</Button>}
          {view.actions.includes('start') && <span className="ml-auto text-ui-compact text-muted-ink">{t('maxParallel')}</span>}
        </div>
      )}
    </div>
  )
}

// Fork（almanac ALMNC-54.7）：秘書照 Scott 親口交代直接改了任務或行程——一行確認，附「復原」。實線框（已生效，不是提案）。
function DirectEditCard({ view, onAction }: { view: DirectEditCardView, onAction: (action: CardAction) => void }) {
  const t = useTranslations('threads.cards')
  const [busy, setBusy] = useState(false)
  return (
    <div data-slot="thread-card" data-card="direct-edit" className="flex items-center gap-2 rounded-(--r-kbd) border border-line-soft bg-bg px-3 py-2 text-sm">
      <Check aria-hidden className="size-3.5 shrink-0 text-muted-ink" />
      <span className={cn('min-w-0 flex-1 truncate text-ink', view.statusKey !== 'directDone' && 'text-muted-ink line-through')}>
        {t('directAdded', { what: view.what })}
      </span>
      {view.agent && <span className="shrink-0 text-ui-compact text-muted-ink">{view.agent}</span>}
      {view.actions.includes('undo') ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            onAction('undo')
          }}
        >
          <Undo2 aria-hidden data-icon="inline-start" />{t('undo')}
        </Button>
      ) : (
        <span className="shrink-0 text-ui-compact text-muted-ink">{t(view.statusKey)}</span>
      )}
    </div>
  )
}

/** 掛在每則訊息下面：這則訊息沒有卡片、或不是新介面時什麼都不畫。 */
export function ThreadMessageCards({ chatId }: { chatId: number }) {
  const isV3 = useUiV3()
  const t = useTranslations('decide')
  const cards = useThreadsStore(state => state.cards[chatId])
  const act = useThreadsStore(state => state.actOnCard)
  const hasProposals = isV3 && cards?.some(card => card.type === 'proposal')
  const trail = useProposalTrailStore(state => hasProposals ? state.trail : undefined)
  const items = useCollectStore(state => hasProposals ? state.items : undefined)
  // 卡片掛在哪則訊息，就來自那則訊息所在的對話
  const conversationId = useChatStore(state => state.chats.find(chat => chat.id === chatId)?.conversationId ?? state.currentConversationId ?? undefined)
  if (!isV3 || !cards?.length) return null
  return (
    <div className="mt-2 flex flex-col gap-2" data-slot="thread-cards">
      {cards.map((card: ThreadCard) => {
        const key = card.type === 'proposal' ? threadProposalKey(card) : ''
        const entry = trail?.[key]
        const source = card.type === 'proposal' ? card.source : undefined
        const proposal = source && items?.find(item => item.id === source.itemId)?.proposals.find(p => p.id === source.proposalId)
        const view = resolveThreadCard(card.type === 'proposal' ? {
          ...card, status: entry?.supersededBy ? 'replaced' : entry?.discussion ? 'talk' : proposal?.status ?? card.status,
        } : card)
        const onAction = (action: CardAction) => void act(chatId, card.id, action)
        const onDiscuss = async (note: string) => {
          if (card.type !== 'proposal') return false
          try {
            await discussProposal({ key, conversationId }, note,
              text => t('discuss.message', { title: card.title, note: text }),
              title => t('discuss.revised', { title }))
            return true
          } catch (error) {
            console.error('[threads] discuss failed:', error)
            toast.error(t('failed'))
            return false
          }
        }
        if (view.type === 'kickoff-result' && view.placeholder) return null
        if (view.type === 'direct-edit') return <DirectEditCard key={card.id} view={view} onAction={onAction} />
        return view.type === 'proposal'
          ? (
            <ProposalCard key={card.id} view={view} onAction={onAction} onDiscuss={onDiscuss}>
              {/* Fork（almanac ALMNC-69.2）：改過標題或位置的新增筆記，接受前後都說明原建議 */}
              {proposal && <NewNoteChanges proposal={proposal} className="mt-1.5" />}
            </ProposalCard>
          )
          : <KickoffCard key={card.id} view={view} onAction={onAction} />
      })}
    </div>
  )
}
