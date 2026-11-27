// Fork（almanac ALMNC-88）：專家回顧領域時產生的「建議你親手整理」包（note.db 的 review_hand_packs）。
// 照舊筆記判斷不出來的包（v3-legacy-packs.ts）的做法：一包一列，Scott 按「整理好了」只記 resolved_at，不刪列、不動筆記檔。
import { getDb } from './index'
import type { ReviewHandPack } from '@/lib/cleanup/fragments'

let initialized: Promise<void> | null = null

export function initReviewPackDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists review_hand_packs (
          id text primary key,
          domain_id text not null,
          domain_name text not null,
          topic text not null,
          reason text not null default '',
          paths text not null,
          by_name text,
          created_at integer not null,
          resolved_at integer
        )
      `)
      await db.execute('create index if not exists idx_review_hand_packs_resolved on review_hand_packs(resolved_at)')
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

interface Row {
  id: string
  domainId: string
  domainName: string
  topic: string
  reason: string
  paths: string
  byName: string | null
  createdAt: number
  resolvedAt: number | null
}

function toPack(row: Row): ReviewHandPack {
  let paths: string[] = []
  try {
    const parsed = JSON.parse(row.paths)
    if (Array.isArray(parsed)) paths = parsed.filter((path): path is string => typeof path === 'string')
  } catch {
    // 壞掉的列當成沒有筆記，不讓整個清單讀不出來。
  }
  return {
    id: row.id, domainId: row.domainId, domainName: row.domainName, topic: row.topic, reason: row.reason ?? '', paths,
    ...(row.byName ? { by: row.byName } : {}), createdAt: Number(row.createdAt),
  }
}

const SELECT = `select id, domain_id as domainId, domain_name as domainName, topic, reason, paths, by_name as byName,
  created_at as createdAt, resolved_at as resolvedAt from review_hand_packs`

export async function addReviewPack(pack: ReviewHandPack): Promise<void> {
  await initReviewPackDb()
  const db = await getDb()
  await db.execute(
    `insert into review_hand_packs (id, domain_id, domain_name, topic, reason, paths, by_name, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict(id) do nothing`,
    [pack.id, pack.domainId, pack.domainName, pack.topic, pack.reason, JSON.stringify(pack.paths), pack.by ?? null, pack.createdAt]
  )
}

/** 還沒整理好的包，舊的在前（工作台卡片）。 */
export async function listOpenReviewPacks(): Promise<ReviewHandPack[]> {
  await initReviewPackDb()
  const db = await getDb()
  const rows = await db.select<Row[]>(`${SELECT} where resolved_at is null order by created_at asc, id asc`)
  return rows.map(toPack).filter(pack => pack.paths.length > 0)
}

/** 去重用：還沒整理好的，加上 since 之後才整理好的。 */
export async function listReviewPacksForDedup(since: number): Promise<ReviewHandPack[]> {
  await initReviewPackDb()
  const db = await getDb()
  const rows = await db.select<Row[]>(`${SELECT} where resolved_at is null or resolved_at >= $1`, [since])
  return rows.map(toPack)
}

export async function setReviewPackResolved(id: string, resolved: boolean, now = Date.now()): Promise<void> {
  await initReviewPackDb()
  const db = await getDb()
  await db.execute('update review_hand_packs set resolved_at = $2 where id = $1', [id, resolved ? now : null])
}
