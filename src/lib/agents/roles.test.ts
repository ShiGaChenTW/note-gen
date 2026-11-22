// Fork（almanac ALMNC-54.2）：四個角色的名單規則與顯示。
import { describe, expect, it } from 'vitest'
import { agentDisplayName, agentRoleLabel } from './display'
import { AGENT_ROLES, DEFAULT_ROSTER, ROLE_TOOLS, availableRoles, normalizeDomain, rosterError } from './settings'

const zhTW: Record<string, string> = { commander: '指揮官', expert: '專家', secretary: '秘書', researcher: '研究員' }
const t = (key: string, values?: Record<string, string>) => key === 'expertOf' ? `${values?.domain}專家` : zhTW[key]

describe('agent roles', () => {
  it('has exactly the four roles from the spec', () => {
    expect(AGENT_ROLES).toEqual(['commander', 'expert', 'secretary', 'researcher'])
  })

  it('allows one commander, secretary and researcher, and many experts', () => {
    const existing = [{ id: '1', role: 'commander' as const }, { id: '2', role: 'expert' as const }]
    expect(rosterError(existing, { role: 'commander' })).toBe('ROLE_TAKEN')
    expect(rosterError(existing, { role: 'commander' }, '1')).toBeNull()
    expect(rosterError(existing, { role: 'secretary' })).toBeNull()
    expect(rosterError(existing, { role: 'expert', domain: '資料工程' })).toBeNull()
    expect(rosterError(existing, { role: 'expert', domain: '  ' })).toBe('DOMAIN_REQUIRED')
    expect(availableRoles(existing)).toEqual(['expert', 'secretary', 'researcher'])
    expect(availableRoles(existing, '1')).toEqual(AGENT_ROLES)
  })

  it('keeps a domain only for experts', () => {
    expect(normalizeDomain('expert', ' 工業工程 ')).toBe('工業工程')
    expect(normalizeDomain('secretary', '工業工程')).toBeUndefined()
  })

  it('shows 本名 · 角色, with experts named after their domain', () => {
    expect(agentDisplayName({ name: 'Mia', role: 'commander' }, t)).toBe('Mia · 指揮官')
    expect(agentDisplayName({ name: 'Alex', role: 'expert', domain: '工業工程' }, t)).toBe('Alex · 工業工程專家')
    expect(agentRoleLabel({ role: 'expert' }, t)).toBe('專家')
  })

  it('offers a default English-named roster without experts', () => {
    expect(DEFAULT_ROSTER.map(agent => `${agent.name}:${agent.role}`)).toEqual(['Mia:commander', 'Leo:secretary', 'Nora:researcher'])
    for (const agent of DEFAULT_ROSTER) expect(agent.allowedTools).toEqual(ROLE_TOOLS[agent.role])
    expect(rosterError([], DEFAULT_ROSTER[0])).toBeNull()
  })
})
