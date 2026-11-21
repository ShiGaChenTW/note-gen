// Fork（almanac ALMNC-54.3）：Agent 設定區資料表，用真的 node:sqlite 測（照 src/lib/agents/schema.test.ts 的做法）。
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AGENT_MEMORY_SCHEMA } from './schema'
import {
  appendActivity, archiveOldActivity, getAgentMemory, getScottPreferences, getSharedContext, listActivity,
  loadAgentMemoryPrompt, saveScottPreferences, saveSharedContext, writeAgentMemory,
} from '@/db/agent-memory'
import type { ActivityEntryInput } from './activity'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    all(bindings: Bindings): unknown[]
    run(bindings: Bindings): { changes: number, lastInsertRowid: number | bigint }
  }
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null>) =>
  Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

vi.mock('@/db/index', () => ({
  executeRecordTransaction: async () => { throw new Error('not used') },
  getDb: async () => ({
    execute: async (sql: string, values: Array<string | number | null> = []) => {
      const result = sqlite.prepare(sql).run(bind(values))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: Array<string | number | null> = []) => sqlite.prepare(sql).all(bind(values)),
  }),
}))

afterAll(() => sqlite.close())

const DAY = 24 * 60 * 60 * 1000
const mia = { id: 'mia', name: 'Mia', role: 'commander' } as const
const leo = { id: 'leo', name: 'Leo', role: 'secretary' } as const
const entry: ActivityEntryInput = {
  actorId: 'leo', actorRole: 'secretary', action: 'created', targetLink: 'task:1', source: { kind: 'conversation', ref: 'c1' },
}

describe('ALMNC-54.3 Agent 設定區', () => {
  it('individual memory: templates on first use, soul for Scott only, rules via proposal, own work notes (AC1)', async () => {
    const first = await getAgentMemory(mia)
    expect(first.soul).toMatchObject({ isTemplate: true, updatedAt: null })
    expect(first.soul.content).toContain('本名：Mia')
    expect(first.rules.isTemplate).toBe(true)
    expect(first.workNotes).toMatchObject({ content: '', isTemplate: false })

    await expect(writeAgentMemory({ agentId: 'mia', role: 'commander' }, mia, 'soul', 'x')).rejects.toThrow('SOUL_SCOTT_ONLY')
    expect(await writeAgentMemory('scott', mia, 'soul', '# soul.md\n- 本名：Mia', 10)).toEqual({ status: 'saved' })
    expect((await getAgentMemory(mia)).soul).toEqual({ content: '# soul.md\n- 本名：Mia', updatedAt: 10, updatedBy: 'scott', isTemplate: false })

    const proposal = await writeAgentMemory({ agentId: 'leo', role: 'secretary' }, leo, 'rules', 'new rules')
    expect(proposal).toMatchObject({ status: 'proposal', proposal: { kind: 'rules-change', agentId: 'leo', after: 'new rules' } })
    expect(proposal.status === 'proposal' && proposal.proposal.before).toContain('# rules.md')
    expect((await getAgentMemory(leo)).rules.isTemplate).toBe(true)
    await writeAgentMemory('scott', leo, 'rules', 'scott rules', 11)
    expect((await getAgentMemory(leo)).rules.content).toBe('scott rules')

    await writeAgentMemory({ agentId: 'leo', role: 'secretary' }, leo, 'work_notes', 'Scott 早上不排會', 12)
    expect((await getAgentMemory(leo)).workNotes).toMatchObject({ content: 'Scott 早上不排會', updatedBy: 'agent:leo' })
    await expect(writeAgentMemory({ agentId: 'mia', role: 'commander' }, leo, 'work_notes', 'x')).rejects.toThrow('WORK_NOTES_NOT_YOURS')
    await expect(writeAgentMemory('scott', leo, 'work_notes', 'x'.repeat(20001))).rejects.toThrow('MEMORY_TOO_LONG')
  })

  it('current context: commander or Scott, with limits (AC2, AC4)', async () => {
    expect(await getSharedContext()).toEqual({ projects: [], weeklyFocus: [], people: [], updatedAt: null, updatedBy: null })
    await saveSharedContext({ agentId: 'mia', role: 'commander' }, {
      projects: [{ title: 'Almanac', link: '[[Almanac]]' }], weeklyFocus: [{ title: 'V3' }], people: ['A'],
    }, 20)
    expect(await getSharedContext()).toEqual({
      projects: [{ title: 'Almanac', link: '[[Almanac]]' }], weeklyFocus: [{ title: 'V3' }], people: ['A'], updatedAt: 20, updatedBy: 'agent:mia',
    })
    await expect(saveSharedContext({ agentId: 'leo', role: 'secretary' }, { projects: [], weeklyFocus: [], people: [] }))
      .rejects.toThrow('CONTEXT_COMMANDER_ONLY')
    const many = Array.from({ length: 11 }, (_, index) => ({ title: `P${index}` }))
    await expect(saveSharedContext('scott', { projects: many, weeklyFocus: [], people: [] })).rejects.toThrow('TOO_MANY_PROJECTS')
    await expect(saveSharedContext('scott', { projects: [], weeklyFocus: many.slice(0, 6), people: [] })).rejects.toThrow('TOO_MANY_FOCUS')
    expect((await getSharedContext()).updatedBy).toBe('agent:mia')
  })

  it('activity log: system only, append-only, corrections, newest first, 90-day archive (AC2, AC3, AC4)', async () => {
    const now = 1000 * DAY
    await expect(appendActivity('scott', entry, now)).rejects.toThrow('ACTIVITY_SYSTEM_ONLY')
    await expect(appendActivity({ agentId: 'leo', role: 'secretary' }, entry, now)).rejects.toThrow('ACTIVITY_SYSTEM_ONLY')
    await expect(appendActivity('system', { ...entry, targetLink: '' }, now)).rejects.toThrow('TARGET_LINK_REQUIRED')
    await expect(appendActivity('system', { ...entry, note: '字'.repeat(61) }, now)).rejects.toThrow('NOTE_TOO_LONG')

    const old = await appendActivity('system', entry, now - 100 * DAY)
    const recent = await appendActivity('system', { ...entry, note: '新增會議' }, now - DAY)
    const fix = await appendActivity('system', { ...entry, action: 'corrected', correctsId: recent, note: '時間記錯' }, now)
    await expect(appendActivity('system', { ...entry, action: 'corrected', correctsId: 999 }, now)).rejects.toThrow('CORRECTION_TARGET_NOT_FOUND')

    const listed = await listActivity({ now })
    expect(listed.map(item => item.id)).toEqual([fix, recent])
    expect(listed[0]).toMatchObject({ action: 'corrected', correctsId: recent, source: { kind: 'conversation', ref: 'c1' }, at: now })
    const all = await listActivity({ now, includeArchived: true })
    expect(all.map(item => item.id)).toEqual([fix, recent, old])
    expect(all[2].archivedAt).toBe(now)
    expect(await archiveOldActivity(now)).toBe(0)

    // 資料庫本身也擋：不能刪、不能改內容、封存後不能再動。
    expect(() => sqlite.exec(`delete from activity_log where id = ${recent}`)).toThrow('ACTIVITY_LOG_APPEND_ONLY')
    expect(() => sqlite.exec(`update activity_log set note = 'x' where id = ${recent}`)).toThrow('ACTIVITY_LOG_APPEND_ONLY')
    expect(() => sqlite.exec(`update activity_log set archived_at = null where id = ${old}`)).toThrow('ACTIVITY_LOG_APPEND_ONLY')
    expect(() => sqlite.exec(`insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref)
      values (1, 'leo', 'secretary', 'created', '  ', 'conversation', 'c')`)).toThrow()
    expect((await listActivity({ now, includeArchived: true })).length).toBe(3)
  })

  it("Scott's preferences: shared by all agents, Scott only (AC5)", async () => {
    expect(await getScottPreferences()).toEqual({ content: '', updatedAt: null })
    await expect(saveScottPreferences({ agentId: 'mia', role: 'commander' }, 'x')).rejects.toThrow('PREFERENCES_SCOTT_ONLY')
    await expect(saveScottPreferences('system', 'x')).rejects.toThrow('PREFERENCES_SCOTT_ONLY')
    await saveScottPreferences('scott', '回覆用繁體中文', 30)
    expect(await getScottPreferences()).toEqual({ content: '回覆用繁體中文', updatedAt: 30 })
    for (const agent of [mia, leo]) expect(await loadAgentMemoryPrompt(agent)).toContain('回覆用繁體中文')
    const prompt = await loadAgentMemoryPrompt(leo)
    expect(prompt).toContain('scott rules')
    expect(prompt).toContain('Scott 早上不排會')
    expect(prompt).toContain('Active projects: Almanac')
  })

  it('schema is idempotent', () => {
    sqlite.exec(AGENT_MEMORY_SCHEMA.join(';\n'))
    expect(sqlite.prepare("select count(*) as n from agent_memory").all({})).toEqual([{ n: 3 }])
  })
})
