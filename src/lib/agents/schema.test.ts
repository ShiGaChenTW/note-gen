import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AGENT_SCHEMA, AGENT_SCHEMA_ROLLBACK, migrateAgentRoles, needsRoleRebuild, rollbackAgentSchema, type RollbackDb, type RoleMigrationStatement } from './schema'
import { LEGACY_EXPERT_DOMAIN, planLegacyRoleMigration } from './settings'
import { createAgentSettings, getAgentSettings, listAgentSettings, listAgentToolRefusals, recordAgentToolRefusal, updateAgentSettings } from '@/db/agents'
import { initAgentTaskDb, listAgentTasks, saveAgentTask } from '@/db/agent-tasks'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    all(bindings: Bindings): unknown[]
    run(bindings: Bindings): { changes: number }
  }
  close(): void
}

// Node 24 (CI) ships SQLite. The repository still uses Node 20 type declarations.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null>) =>
  Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

const runTransaction = async (statements: RoleMigrationStatement[]) => {
  sqlite.exec('begin')
  try {
    for (const statement of statements) sqlite.prepare(statement.sql).run(bind(statement.values))
    sqlite.exec('commit')
  } catch (error) {
    sqlite.exec('rollback')
    throw error
  }
}

vi.mock('@/db/index', () => ({
  executeRecordTransaction: async (statements: RoleMigrationStatement[]) => runTransaction(statements),
  getDb: async () => ({
    execute: async (sql: string, values: Array<string | number | null> = []) =>
      ({ rowsAffected: sqlite.prepare(sql).run(bind(values)).changes }),
    select: async (sql: string, values: Array<string | number | null> = []) =>
      sqlite.prepare(sql).all(bind(values)),
  }),
}))

afterAll(() => sqlite.close())

describe('P5 SQLite schema and settings', () => {
  it('upgrades an existing task DB, persists settings and refusals, and rolls back only P5 data', async () => {
    await initAgentTaskDb()
    const report = { id: 'old', kind: 'report', status: 'completed', title: 'Weekly', prompt: 'Report',
      drafts: [], tokens: 4, createdAt: 1, updatedAt: 2 } as const
    await saveAgentTask({ ...report, drafts: [] })
    const before = await listAgentTasks()

    expect(await listAgentSettings()).toEqual([])
    const id = await createAgentSettings({
      name: ' Mia ', role: 'commander', enabled: true,
      allowedTools: ['note_read_file', 'note_create_file', 'note_read_file'],
    })
    const created = await getAgentSettings(id)
    expect(created).toMatchObject({
      id, name: 'Mia', role: 'commander', enabled: true,
      allowedTools: ['note_read_file', 'note_create_file'],
    })
    await updateAgentSettings(id, { name: 'Alex', role: 'expert', domain: ' 工業工程 ', enabled: false, allowedTools: [] })
    expect(await listAgentSettings()).toEqual([
      expect.objectContaining({ id, name: 'Alex', role: 'expert', domain: '工業工程', enabled: false, allowedTools: [], createdAt: created?.createdAt }),
    ])
    await expect(updateAgentSettings('missing', { name: 'A', role: 'expert', domain: 'X', enabled: true, allowedTools: [] }))
      .rejects.toThrow('AGENT_NOT_FOUND')
    // 單一角色只能一位；專家要有領域（ALMNC-54.2）。
    const secretary = await createAgentSettings({ name: 'Leo', role: 'secretary', enabled: true, allowedTools: [] })
    await expect(createAgentSettings({ name: 'Leo 2', role: 'secretary', enabled: true, allowedTools: [] })).rejects.toThrow('ROLE_TAKEN')
    await expect(createAgentSettings({ name: 'Bo', role: 'expert', enabled: true, allowedTools: [] })).rejects.toThrow('DOMAIN_REQUIRED')
    await updateAgentSettings(secretary, { name: 'Leon', role: 'secretary', enabled: true, allowedTools: [] })
    sqlite.exec(`delete from agent_settings where id = '${secretary}'`)

    await saveAgentTask({ ...before[0], id: 'p5', kind: `agent:${id}` })
    const refusal = { agentId: id, taskId: 'p5', toolName: 'note_delete_file', reason: 'not_granted', createdAt: 3 } as const
    await recordAgentToolRefusal(refusal)
    expect(await listAgentToolRefusals('p5')).toEqual([refusal])
    expect(await listAgentToolRefusals('old')).toEqual([])

    sqlite.exec(AGENT_SCHEMA.join(';\n'))
    expect(await listAgentToolRefusals('p5')).toEqual([refusal])
    expect(await getAgentSettings(id)).toMatchObject({ enabled: false })

    sqlite.exec(`begin;\n${AGENT_SCHEMA_ROLLBACK.join(';\n')};\ncommit;`)
    expect(await listAgentTasks()).toEqual(before)
    expect(sqlite.prepare("select name from sqlite_master where name in ('agent_settings', 'agent_tool_refusals')").all({}))
      .toEqual([])
    sqlite.exec(AGENT_SCHEMA.join(';\n'))
    expect(await listAgentSettings()).toEqual([])
    expect(await listAgentToolRefusals('p5')).toEqual([])
  })

  describe('rollbackAgentSchema (review findings 1, 2)', () => {
    const tasks = () => sqlite.prepare('select id, kind from agent_tasks order by id').all({}) as Array<{ id: string, kind: string }>
    const rollbackDb = (failOn?: string): RollbackDb => ({
      select: async <T,>(sql: string) => sqlite.prepare(sql).all({}) as T,
      execute: async (sql: string) => {
        if (failOn && sql.includes(failOn)) throw new Error('simulated failure')
        sqlite.exec(sql)
      },
    })
    const seed = async (status: string) => {
      sqlite.exec(AGENT_SCHEMA.join(';\n'))
      await initAgentTaskDb()
      sqlite.exec('delete from agent_tasks')
      const base = { title: 't', prompt: 'p', drafts: [], tokens: 0, createdAt: 1, updatedAt: 1 } as const
      await saveAgentTask({ ...base, id: 'a', kind: 'agent:x', status } as never)
      await saveAgentTask({ ...base, id: 'b', kind: 'AGENT:legacy', status: 'completed' } as never)
      await saveAgentTask({ ...base, id: 'c', kind: 'report', status: 'completed' } as never)
    }

    it('refuses while agent drafts await review, unless told to discard them', async () => {
      await seed('awaiting_review')
      await expect(rollbackAgentSchema(rollbackDb())).rejects.toThrow('AGENT_ROLLBACK_PENDING_REVIEW')
      expect(tasks().map(t => t.id)).toEqual(['a', 'b', 'c'])
      await rollbackAgentSchema(rollbackDb(), { discardPendingReview: true })
      expect(tasks().map(t => t.id)).toEqual(['b', 'c'])
    })

    it('only removes lowercase agent: kinds (LIKE would also match AGENT:legacy)', async () => {
      await seed('completed')
      await rollbackAgentSchema(rollbackDb())
      expect(tasks()).toEqual([{ id: 'b', kind: 'AGENT:legacy' }, { id: 'c', kind: 'report' }])
    })

    it('rolls back everything when a statement fails midway', async () => {
      await seed('completed')
      await expect(rollbackAgentSchema(rollbackDb('drop table if exists agent_settings'))).rejects.toThrow('simulated failure')
      expect(tasks().map(t => t.id)).toEqual(['a', 'b', 'c'])
      expect(sqlite.prepare("select name from sqlite_master where name in ('agent_settings', 'agent_tool_refusals') order by name").all({}))
        .toEqual([{ name: 'agent_settings' }, { name: 'agent_tool_refusals' }])
    })
  })

  describe('ALMNC-54.2 角色升級', () => {
    const LEGACY_TABLE = `create table agent_settings (
      id text primary key not null,
      name text not null check (length(trim(name)) between 1 and 80),
      role text not null check (role in ('organizer', 'scheduler', 'researcher', 'reviewer', 'custom')),
      enabled integer not null check (enabled in (0, 1)),
      allowed_tools text not null,
      created_at integer not null,
      updated_at integer not null
    )`
    const migrationDb = { select: async <T,>(sql: string) => sqlite.prepare(sql).all({}) as T }

    it('maps legacy roles in creation order and keeps single roles unique', () => {
      expect(planLegacyRoleMigration([
        { id: 'b', role: 'organizer', enabled: 1, createdAt: 2 },
        { id: 'a', role: 'organizer', enabled: 1, createdAt: 1 },
        { id: 'c', role: 'scheduler', enabled: 0, createdAt: 3 },
        { id: 'd', role: 'researcher', enabled: 1, createdAt: 4 },
        { id: 'e', role: 'reviewer', enabled: 1, createdAt: 5 },
        { id: 'f', role: 'custom', enabled: 1, createdAt: 6 },
      ])).toEqual([
        { id: 'a', role: 'commander', domain: null, enabled: 1 },
        { id: 'b', role: 'expert', domain: LEGACY_EXPERT_DOMAIN, enabled: 0 },
        { id: 'c', role: 'secretary', domain: null, enabled: 0 },
        { id: 'd', role: 'researcher', domain: null, enabled: 1 },
        { id: 'e', role: 'expert', domain: LEGACY_EXPERT_DOMAIN, enabled: 1 },
        { id: 'f', role: 'expert', domain: LEGACY_EXPERT_DOMAIN, enabled: 1 },
      ])
    })

    it('rebuilds a legacy table once, keeping ids, names, tools and timestamps', async () => {
      sqlite.exec('drop table if exists agent_settings')
      sqlite.exec(LEGACY_TABLE)
      sqlite.exec(`insert into agent_settings values
        ('x', 'Planner', 'scheduler', 1, '["calendar_read_day"]', 10, 11),
        ('y', 'Helper', 'custom', 1, '[]', 20, 21)`)
      expect(needsRoleRebuild((sqlite.prepare("select sql from sqlite_master where name = 'agent_settings'").all({})[0] as { sql: string }).sql)).toBe(true)
      expect(await migrateAgentRoles(migrationDb, runTransaction)).toBe(true)
      expect(sqlite.prepare('select id, name, role, domain, enabled, allowed_tools as tools, created_at as c, updated_at as u from agent_settings order by id').all({})).toEqual([
        { id: 'x', name: 'Planner', role: 'secretary', domain: null, enabled: 1, tools: '["calendar_read_day"]', c: 10, u: 11 },
        { id: 'y', name: 'Helper', role: 'expert', domain: LEGACY_EXPERT_DOMAIN, enabled: 1, tools: '[]', c: 20, u: 21 },
      ])
      expect(await migrateAgentRoles(migrationDb, runTransaction)).toBe(false)
      expect(() => sqlite.exec(`insert into agent_settings values ('z', 'Old', 'organizer', null, 1, '[]', 1, 1)`)).toThrow()
    })

    it('leaves the legacy table untouched when the rebuild fails', async () => {
      sqlite.exec('drop table if exists agent_settings')
      sqlite.exec(LEGACY_TABLE)
      sqlite.exec(`insert into agent_settings values ('x', 'Planner', 'scheduler', 1, '[]', 10, 11)`)
      const failing = async (statements: RoleMigrationStatement[]) =>
        runTransaction([...statements.slice(0, -1), { sql: 'select broken from nowhere', values: [] }])
      await expect(migrateAgentRoles(migrationDb, failing)).rejects.toThrow()
      expect(sqlite.prepare('select id, role from agent_settings').all({})).toEqual([{ id: 'x', role: 'scheduler' }])
      sqlite.exec('drop table agent_settings')
      sqlite.exec(AGENT_SCHEMA.join(';\n'))
    })
  })
})
