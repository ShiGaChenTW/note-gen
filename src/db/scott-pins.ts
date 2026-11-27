// Fork（almanac ALMNC-69.11）：「Scott 指定」標記（note.db 的 scott_pins）。不寫進筆記檔，存在系統索引旁邊。
// 每個位置一筆 pinned_at：收錄（M＋N）、區塊（M＋區塊名）、章節（C）；同一個位置再標一次只更新時間（pin_key 見 lib/moc/scott-pins pinKey）。
// 新表，用 create table if not exists 建立（同 ops、moc_snapshots 的延遲初始化），對舊資料庫安全、可重跑。以工作區隔離（同 ops）。
// 90 天後失效：讀取時只回傳有效的，順手刪掉過期的。
import { getDb } from './index'
import { isPinActive, pinKey, SCOTT_PIN_TTL_MS, type ScottPin, type ScottPinKind } from '@/lib/moc/scott-pins'
import type { MocBlockKey } from '@/lib/moc/parse'
import { SCOTT_PINS_SCHEMA } from '@/lib/moc/schema'
import { notifyAlmanacLocalChange } from '@/lib/almanac-sync/notify'

const KINDS: readonly ScottPinKind[] = ['relation', 'position', 'chapter-title', 'block']

interface PinRow {
  kind: string
  mocId: string | null
  mocPath: string
  mocName: string
  noteId: string | null
  notePath: string | null
  chapterId: string | null
  block: string | null
  opId: string | null
  pinnedAt: number
}

let initialized: Promise<void> | null = null

export function initScottPinsDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(SCOTT_PINS_SCHEMA)
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

export function pinFromRow(row: PinRow): ScottPin | null {
  if (!KINDS.includes(row.kind as ScottPinKind)) return null
  return {
    kind: row.kind as ScottPinKind,
    mocPath: row.mocPath,
    mocName: row.mocName,
    ...(row.mocId ? { mocId: row.mocId } : {}),
    ...(row.notePath ? { notePath: row.notePath } : {}),
    ...(row.noteId ? { noteId: row.noteId } : {}),
    ...(row.chapterId ? { chapterId: row.chapterId } : {}),
    ...(row.block ? { block: row.block as MocBlockKey } : {}),
    ...(row.opId ? { opId: row.opId } : {}),
    at: Number(row.pinnedAt),
  }
}

async function currentWorkspace(): Promise<string> {
  const { default: useSettingStore } = await import('@/stores/setting')
  return useSettingStore.getState().workspacePath ?? ''
}

export interface ScottPinStore {
  /** 記下標記（同一個位置只留最新的時間）。 */
  save: (pins: readonly ScottPin[]) => Promise<void>
  /** 有效的標記（未滿 90 天）；過期的順手刪掉。 */
  active: (now?: number) => Promise<ScottPin[]>
}

export function createScottPinStore(workspace: () => Promise<string> | string = currentWorkspace): ScottPinStore {
  return {
    save: async pins => {
      if (!pins.length) return
      await initScottPinsDb()
      const db = await getDb()
      const scope = await workspace()
      for (const pin of pins) {
        await db.execute(
          `insert into scott_pins (workspace, pin_key, kind, moc_id, moc_path, moc_name, note_id, note_path, chapter_id, block, op_id, pinned_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            on conflict(workspace, pin_key) do update set kind = excluded.kind, moc_id = excluded.moc_id, moc_path = excluded.moc_path,
              moc_name = excluded.moc_name, note_id = excluded.note_id, note_path = excluded.note_path, chapter_id = excluded.chapter_id,
              block = excluded.block, op_id = excluded.op_id, pinned_at = max(scott_pins.pinned_at, excluded.pinned_at)`,
          [scope, pinKey(pin), pin.kind, pin.mocId ?? null, pin.mocPath, pin.mocName, pin.noteId ?? null, pin.notePath ?? null,
            pin.chapterId ?? null, pin.block ?? null, pin.opId ?? null, pin.at],
        )
      }
      // Fork（almanac ALMNC-85.4）：Scott 指定也同步（設計 2.15）。
      notifyAlmanacLocalChange('scott-pins')
    },
    active: async (now = Date.now()) => {
      await initScottPinsDb()
      const db = await getDb()
      const scope = await workspace()
      await db.execute('delete from scott_pins where workspace = $1 and pinned_at <= $2', [scope, now - SCOTT_PIN_TTL_MS])
      const rows = await db.select<PinRow[]>(
        `select kind, moc_id as mocId, moc_path as mocPath, moc_name as mocName, note_id as noteId, note_path as notePath,
          chapter_id as chapterId, block, op_id as opId, pinned_at as pinnedAt from scott_pins where workspace = $1`,
        [scope],
      )
      return rows.flatMap(row => pinFromRow(row) ?? []).filter(pin => isPinActive(pin, now))
    },
  }
}

export const scottPinStore = createScottPinStore()
