"use client"

import { ChevronDown, Eye, ShieldCheck, ShieldQuestion } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ResponsiveActionMenu } from "@/components/responsive-action-menu"
import type { AgentPermissionMode } from "@/lib/agent/types"
import useChatStore from "@/stores/chat"
import useSettingStore from "@/stores/setting"
import { cn } from '@/lib/utils'

export function ChatModeSwitch({ readOnly, disabled, onChange }: {
  readOnly: boolean
  disabled: boolean
  onChange: (readOnly: boolean) => void
}) {
  const t = useTranslations('record.chat.v3.mode')
  return (
    <div role="group" aria-label={t('label')} title={t('shortcut')}
      className="inline-flex shrink-0 self-start rounded-full bg-sunken p-0.5">
      {([true, false] as const).map(ask => (
        <button key={String(ask)} type="button" aria-pressed={readOnly === ask} disabled={disabled}
          onClick={() => onChange(ask)}
          className="h-[22px] rounded-full px-2.5 text-xs text-muted-ink hover:text-ink aria-pressed:bg-bg aria-pressed:font-semibold aria-pressed:text-ink disabled:opacity-60">
          {t(ask ? 'ask' : 'delegate')}
        </button>
      ))}
    </div>
  )
}

const MODE_ICONS = {
  "read-only": Eye,
  ask: ShieldQuestion,
  "auto-edit": ShieldCheck,
} satisfies Record<AgentPermissionMode, typeof Eye>

const MODE_COLORS = {
  "read-only": "text-muted-foreground",
  ask: "text-warning-foreground",
  "auto-edit": "text-destructive",
} satisfies Record<AgentPermissionMode, string>

export function AgentPermissionModeSelect({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("record.chat.input.agent.permissionMode")
  const tV3 = useTranslations('record.chat.v3.mode')
  const { agentPermissionMode, setAgentPermissionMode } = useSettingStore()
  const loading = useChatStore((state) => state.loading)
  const Icon = MODE_ICONS[agentPermissionMode]
  const modes = compact ? (["ask", "auto-edit"] as const) : (["read-only", "ask", "auto-edit"] as const)
  const modeTitle = (mode: AgentPermissionMode) => compact && mode !== 'read-only' ? tV3(mode === 'ask' ? 'ask-before-edit' : 'auto-edit') : t(`modes.${mode}.title`)

  const handleChange = (value: string) => {
    if (value === "read-only" || value === "ask" || value === "auto-edit") {
      const update = setAgentPermissionMode(value)
      if (compact) void update.catch(error => console.error('Failed to persist chat permissions:', error))
    }
  }

  return (
    <ResponsiveActionMenu
      title={t("label")}
      desktopClassName="w-[30rem] max-w-[calc(100vw-2rem)]"
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          className={cn("h-8 gap-1.5 px-2 text-xs text-muted-foreground", compact && "h-6 min-w-0 gap-1 px-1.5 text-[11px] text-faint hover:bg-hover hover:text-ink")}
          aria-label={t("label")}
        >
          <Icon data-icon="inline-start" className={compact ? "size-3" : MODE_COLORS[agentPermissionMode]} />
          <span className={compact ? "truncate" : "hidden md:inline"}>{modeTitle(agentPermissionMode)}</span>
          {compact && <ChevronDown className="size-3 shrink-0" />}
        </Button>
      }
      items={modes.map(mode => {
        const ModeIcon = MODE_ICONS[mode]
        return {
          key: mode,
          icon: (
            <span className={compact ? "text-muted-ink" : MODE_COLORS[mode]}>
              <ModeIcon data-icon="inline-start" aria-hidden="true" />
            </span>
          ),
          multiline: true,
          label: (
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span>{modeTitle(mode)}</span>
              <span className="text-xs leading-relaxed font-normal text-muted-foreground">{t(`modes.${mode}.description`)}</span>
            </span>
          ),
          selected: mode === agentPermissionMode,
          onSelect: () => handleChange(mode),
        }
      })}
    />
  )
}
