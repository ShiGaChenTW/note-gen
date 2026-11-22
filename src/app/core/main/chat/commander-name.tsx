'use client'

// Fork（almanac ALMNC-54.7）：右側欄的 AI 就是指揮官，顯示成「本名 · 指揮官」（例如「Mia · 指揮官」）。
// 名單從 Agent 設定讀；讀不到（沒有 Tauri）就只顯示角色名稱。同一次啟動共用一份，10 秒內不重讀。
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ensureDefaultRoster, listAgentSettings } from '@/db/agents'
import { commanderDisplayName, type SidebarRosterAgent } from '@/lib/commander/sidebar-session'

const REFRESH_MS = 10_000
let cache: { at: number, roster: Promise<SidebarRosterAgent[]> } | undefined

function loadRoster(): Promise<SidebarRosterAgent[]> {
  if (!cache || Date.now() - cache.at > REFRESH_MS) {
    cache = { at: Date.now(), roster: ensureDefaultRoster().catch(() => false).then(() => listAgentSettings()) }
  }
  return cache.roster
}

export function useCommanderName(): string {
  const tRoles = useTranslations('agents.roles')
  const [roster, setRoster] = useState<SidebarRosterAgent[]>([])
  useEffect(() => {
    let alive = true
    loadRoster().then(next => { if (alive) setRoster(next) }).catch(() => { cache = undefined })
    return () => { alive = false }
  }, [])
  return commanderDisplayName(roster, (key, values) => tRoles(key, values))
}

/** 新介面裡 AI 訊息上方的一行名字。 */
export function CommanderSpeaker() {
  const name = useCommanderName()
  return <div data-slot="commander-speaker" className="text-ui-compact text-muted-ink">{name}</div>
}
