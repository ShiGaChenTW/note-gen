// Fork（almanac ALMNC-85.4）：updated_at（M7）讓 V3 同步判斷哪台較晚改；寫入後排 almanac 同步（設計 2.12）。
import { getDb } from './index'
import type { MocPositions } from '@/lib/moc/positions'
import { ensureMocPositionsSchema } from '@/lib/moc/schema'
import { notifyAlmanacLocalChange } from '@/lib/almanac-sync/notify'

let ready: Promise<unknown> | undefined

async function database() {
  const db = await getDb()
  ready ??= ensureMocPositionsSchema(db).catch(error => { ready = undefined; throw error })
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
    notifyAlmanacLocalChange('moc-positions')
    return
  }
  await db.execute(`insert into moc_positions (workspace, moc_id, positions, updated_at) values ($1, $2, $3, $4)
    on conflict(workspace, moc_id) do update set positions = excluded.positions, updated_at = excluded.updated_at`, [workspace, mocId, JSON.stringify(positions), Date.now()])
  notifyAlmanacLocalChange('moc-positions')
}
