// Fork（almanac ALMNC-85.2 骨架）：別名表 almanac_sync_aliases（設計 1.3、M4）。
// 兩台各自產生不同 id、其實是同一筆時（各自遷移出不同 S 編號、各建一位預設指揮官、各自訂閱同一網址），
// 選一個正式 id，另一個記成別名：可以改的引用合併時改寫成正式 id；不能改的（只能新增的表）讀取時查別名換算。
import { initAlmanacSyncTables, type AlmanacSqlDb } from './sql'

export interface AliasCandidate {
  id: string
  /** 有建立時間就用「較早的」當正式 id（單例角色、RSS 訂閱）；沒有就比字串（身分編號） */
  createdAt?: number | null
}

/** 純函式：兩個候選選出正式 id。結果在兩台一定相同（同時間再比字串）。 */
export function chooseCanonicalId(left: AliasCandidate, right: AliasCandidate): { canonical: string; alias: string } {
  if (left.id === right.id) return { canonical: left.id, alias: right.id }
  const leftAt = left.createdAt ?? null
  const rightAt = right.createdAt ?? null
  if (leftAt !== null && rightAt !== null && leftAt !== rightAt) {
    return leftAt < rightAt ? { canonical: left.id, alias: right.id } : { canonical: right.id, alias: left.id }
  }
  return left.id < right.id ? { canonical: left.id, alias: right.id } : { canonical: right.id, alias: left.id }
}

export async function recordAlias(db: AlmanacSqlDb, table: string, aliasId: string, canonicalId: string, now: number): Promise<void> {
  if (aliasId === canonicalId) return
  await initAlmanacSyncTables(db)
  // 正式 id 本身若曾是別的別名，改指到最終的正式 id，避免鏈太長。
  const finalCanonical = await resolveAlias(db, table, canonicalId)
  await db.execute(
    `insert into almanac_sync_aliases (table_name, alias_id, canonical_id, created_at) values ($1, $2, $3, $4)
     on conflict(table_name, alias_id) do update set canonical_id = excluded.canonical_id`,
    [table, aliasId, finalCanonical, now],
  )
  // 原本指向 aliasId 的別名一起改指正式 id。
  await db.execute('update almanac_sync_aliases set canonical_id = $1 where table_name = $2 and canonical_id = $3', [finalCanonical, table, aliasId])
}

/** 查正式 id；不是別名就原樣回傳。舊編號永遠可以解析（身分編號「一經產生不改」靠這個保住）。 */
export async function resolveAlias(db: AlmanacSqlDb, table: string, id: string): Promise<string> {
  await initAlmanacSyncTables(db)
  let current = id
  for (let depth = 0; depth < 8; depth++) {
    const rows = await db.select<Array<{ canonicalId: string }>>(
      'select canonical_id as canonicalId from almanac_sync_aliases where table_name = $1 and alias_id = $2',
      [table, current],
    )
    const next = rows[0]?.canonicalId
    if (!next || next === current) return current
    current = next
  }
  return current
}

export async function loadAliasMap(db: AlmanacSqlDb, table: string): Promise<Map<string, string>> {
  await initAlmanacSyncTables(db)
  const rows = await db.select<Array<{ aliasId: string; canonicalId: string }>>(
    'select alias_id as aliasId, canonical_id as canonicalId from almanac_sync_aliases where table_name = $1',
    [table],
  )
  return new Map(rows.map(row => [row.aliasId, row.canonicalId]))
}
