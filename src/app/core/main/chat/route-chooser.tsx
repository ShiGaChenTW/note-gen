'use client'

// Fork（almanac ALMNC-54.11）：路由器第三層「問 Scott」——輸入框上方一小列。
// - 要交給誰：日程（秘書）、處理（指揮官）、查詢（專家）、偏好（設定）；模型猜的那一個標成「建議」。
// - 問哪位專家：看不出領域時列出專家本名。
// - 偏好：一行確認「存成你的偏好：…？」，可以存、或改交給指揮官。
// Esc 或 ✕ 取消，字留在輸入框。判斷與後續動作都在送出流程（chat-send.tsx）與 lib/router/。
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ROUTES, type Route } from '@/lib/router/router'
import { useRoster } from '@/lib/workbench/use-workbench'
import { cn } from '@/lib/utils'
import useRouterStore from '@/stores/router'

const ROUTE_ROLE_NAME: Record<Route, 'secretary' | 'commander' | 'expert' | null> = {
  schedule: 'secretary', process: 'commander', query: 'expert', preference: null,
}

export function RouteChooser() {
  const t = useTranslations('record.chat.v3.router')
  const roles = useTranslations('agents.roles')
  const prompt = useRouterStore(state => state.prompt)
  const answer = useRouterStore(state => state.answer)
  const roster = useRoster()

  useEffect(() => {
    if (!prompt) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') answer({ kind: 'cancel' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prompt, answer])

  if (!prompt) return null
  const { plan } = prompt
  const nameOf = (role: 'secretary' | 'commander' | 'expert') => roster.find(agent => agent.role === role && agent.enabled)?.name || roles(role)

  let question = ''
  let options: Array<{ key: string, label: string, primary?: boolean, onClick: () => void }> = []
  if (plan.kind === 'askRoute') {
    const { decision } = plan
    question = decision.reason === 'model_unavailable' ? t('askUnavailable') : t('ask')
    options = ROUTES.map(route => {
      const role = ROUTE_ROLE_NAME[route]
      return {
        key: route,
        label: t(`routes.${route}`, { name: role ? (role === 'expert' ? roles('expert') : nameOf(role)) : '' }),
        primary: decision.suggestion === route,
        onClick: () => answer({ kind: 'route', route }),
      }
    })
  } else if (plan.kind === 'askExpert') {
    question = t('pickExpert')
    options = plan.candidates.map(agent => ({
      key: agent.id,
      label: agent.domain ? `${agent.name}（${agent.domain}）` : agent.name,
      onClick: () => answer({ kind: 'expert', agentId: agent.id }),
    }))
  } else {
    question = t('preferenceConfirm', { line: plan.line })
    options = [
      { key: 'save', label: t('savePreference'), primary: true, onClick: () => answer({ kind: 'savePreference' }) },
      { key: 'process', label: t('notPreference', { name: nameOf('commander') }), onClick: () => answer({ kind: 'notPreference' }) },
    ]
  }

  return (
    <div
      role="group"
      aria-label={question}
      data-slot="route-chooser"
      data-kind={plan.kind}
      className="mx-3 mb-1.5 flex w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-ui-compact"
    >
      <span className="min-w-0 flex-1 basis-full truncate text-ink sm:basis-auto">{question}</span>
      {options.map(option => (
        <Button
          key={option.key}
          type="button"
          size="sm"
          variant={option.primary ? 'default' : 'outline'}
          data-route={option.key}
          className={cn('h-7 shrink-0')}
          onClick={option.onClick}
        >
          {option.label}
          {option.primary && plan.kind === 'askRoute' && <span className="ml-1 text-[11px] opacity-70">{t('suggested')}</span>}
        </Button>
      ))}
      <button type="button" aria-label={t('cancel')} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-ink hover:bg-hover hover:text-ink" onClick={() => answer({ kind: 'cancel' })}>
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
