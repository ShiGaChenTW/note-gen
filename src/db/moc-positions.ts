import { getDb } from './index'
import type { MocPositions } from '@/lib/moc/positions'

let ready: Promise<unknown> | undefined

async function database() {
  const db = await getDb()
  ready ??= db.execute(`create table if not exists moc_positions (
    workspace text not null, moc_id text not null, positions text not null,
    primary key (workspace, moc_id)
  )`).catch(error => { ready = undefined; throw error })
  await ready
  return db
}

export async function loadMocPositions(workspace: string): Promise<Map<string, MocPositions>> {
  const db = await database()
  const rows = await db.select<Array<{ mocId: string, positions: string }>>(
    'select moc_id as mocId, positions from moc_positions where workspace = $1', [workspace],
  )
  return new Map(rows.map(row => [row.mocId, JSON.parse(row.positions) as MocPositions]))
}

export async function saveMocPositions(workspace: string, mocId: string, positions: MocPositions | null): Promise<void> {
  const db = await database()
  if (!positions) {
    await db.execute('delete from moc_positions where workspace = $1 and moc_id = $2', [workspace, mocId])
    return
  }
  await db.execute(`insert into moc_positions (workspace, moc_id, positions) values ($1, $2, $3)
    on conflict(workspace, moc_id) do update set positions = excluded.positions`, [workspace, mocId, JSON.stringify(positions)])
}
