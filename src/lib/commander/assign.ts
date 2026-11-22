// Fork（almanac ALMNC-54.6）：分析第五步「分派」（11/20 修訂）。純函式。
// - 知識片段屬於已有專家負責的領域 → C1 那位專家撰寫。
// - 知識片段還沒有領域或沒有專家、紀錄筆記、專案筆記 → C2 指揮官撰寫。
// - 行動（行程、任務）→ C3 秘書整理。
// - 不採用 → 不撰寫，只記錄。
import { domainPath, type Domain } from '@/lib/v3-model/domain'
import type { Assignment, Fragment, RosterAgent } from './types'

/** 名稱比對：去空白、不分大小寫、全形箭號與 > 都當成層級分隔。 */
export function normalizeDomainName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s*(›|>|＞|\/)\s*/g, '›').replace(/\s+/g, ' ')
}

/** domainHint 對到領域表的哪一個：比 id、名稱、完整路徑（「工程 › 資料工程」）。 */
export function resolveDomain(hint: string | undefined, domains: readonly Domain[]): Domain | undefined {
  const key = normalizeDomainName(hint)
  if (!key) return undefined
  return domains.find(domain => domain.id === hint?.trim())
    ?? domains.find(domain => normalizeDomainName(domainPath(domains, domain.id)) === key)
    ?? domains.find(domain => normalizeDomainName(domain.name) === key)
}

/**
 * 負責這個領域的專家（只找啟用中的）。專家的 domain 是設定頁填的文字，
 * 所以同時比對領域名稱、完整路徑和 domainHint 本身（領域表還沒建時也能對到）。
 */
export function expertFor(hint: string | undefined, domain: Domain | undefined, domains: readonly Domain[], roster: readonly RosterAgent[]): RosterAgent | undefined {
  const keys = new Set([normalizeDomainName(hint)])
  if (domain) {
    keys.add(normalizeDomainName(domain.name))
    keys.add(normalizeDomainName(domainPath(domains, domain.id)))
    keys.add(normalizeDomainName(domain.id))
  }
  keys.delete('')
  if (!keys.size) return undefined
  return roster.find(agent => agent.role === 'expert' && agent.enabled && keys.has(normalizeDomainName(agent.domain)))
}

function single(roster: readonly RosterAgent[], role: 'commander' | 'secretary'): string | undefined {
  return roster.find(agent => agent.role === role && agent.enabled)?.id
}

export function assign(fragments: readonly Fragment[], roster: readonly RosterAgent[], domains: readonly Domain[]): Assignment[] {
  const commander = single(roster, 'commander')
  const secretary = single(roster, 'secretary')
  return fragments.map((fragment): Assignment => {
    if (fragment.kind === 'reject') return { fragment, lane: 'reject' }
    if (fragment.kind === 'event' || fragment.kind === 'task') return { fragment, lane: 'C3', agentId: secretary }
    if (fragment.noteType === 'knowledge') {
      const domain = resolveDomain(fragment.domainHint, domains)
      const expert = expertFor(fragment.domainHint, domain, domains, roster)
      if (expert) return { fragment, lane: 'C1', agentId: expert.id, ...(domain ? { domainId: domain.id } : {}) }
      return { fragment, lane: 'C2', agentId: commander, ...(domain ? { domainId: domain.id } : {}) }
    }
    return { fragment, lane: 'C2', agentId: commander }
  })
}
