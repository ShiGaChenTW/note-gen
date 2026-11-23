// Fork（almanac ALMNC-69.7）：domains 表退成索引快取——可以由 MOC 檔重建，不再是權威。純函式算出要補的列與要改的上層／名稱；
// SQL 在 src/db/v3-domains.ts（syncDomainsTableFromMocs）。
// 對應：先比 id（由這裡補進去的列，id 就是 M 編號），再比名稱（69.6 遷移前建的舊列，id 是 dom_…）。
// 沒有 MOC 檔的舊列不刪（可能是還沒遷移的領域），只列在 orphans 回報。
import type { ParsedMoc } from './parse'

export interface DomainsTableRow {
  id: string
  name: string
  parentId?: string | null
}

export interface DomainsSyncPlan {
  inserts: Array<{ id: string, name: string, parentId?: string }>
  updates: Array<{ id: string, name?: string, parentId?: string | null }>
  /** 沒有對應 MOC 檔的列（不動）。 */
  orphans: Array<{ id: string, name: string }>
  /** 沒有 M 編號、還不能補進表的 MOC（掃描補號後下次再補）。 */
  skipped: string[]
}

export function planDomainsTableSync(mocs: readonly Pick<ParsedMoc, 'id' | 'name' | 'parent' | 'path'>[], rows: readonly DomainsTableRow[]): DomainsSyncPlan {
  const byId = new Map(rows.map(row => [row.id, row]))
  const byName = new Map<string, DomainsTableRow>()
  for (const row of rows) if (!byName.has(row.name.trim())) byName.set(row.name.trim(), row)
  const used = new Set<string>()
  const skipped: string[] = []
  const rowIdOf = new Map<string, string>() // M 編號 → 表裡的 id
  const pending: Array<{ moc: Pick<ParsedMoc, 'id' | 'name' | 'parent'>, row?: DomainsTableRow }> = []
  for (const moc of mocs) {
    const name = moc.name.trim()
    if (!moc.id || !name) {
      skipped.push(moc.path ?? name)
      continue
    }
    let row = byId.get(moc.id)
    if (row && used.has(row.id)) row = undefined
    if (!row) {
      const candidate = byName.get(name)
      if (candidate && !used.has(candidate.id)) row = candidate
    }
    if (row) used.add(row.id)
    rowIdOf.set(moc.id, row?.id ?? moc.id)
    pending.push({ moc, row })
  }
  const inserts: DomainsSyncPlan['inserts'] = []
  const updates: DomainsSyncPlan['updates'] = []
  for (const { moc, row } of pending) {
    const parentId = moc.parent ? rowIdOf.get(moc.parent) : undefined
    if (!row) {
      inserts.push({ id: moc.id!, name: moc.name.trim(), ...(parentId ? { parentId } : {}) })
      continue
    }
    const update: DomainsSyncPlan['updates'][number] = { id: row.id }
    if (row.name.trim() !== moc.name.trim()) update.name = moc.name.trim()
    // 上層的 MOC 不在這次的清單裡（例如檔案讀不到）時不動上層，避免誤拆。
    if (!moc.parent && row.parentId) update.parentId = null
    else if (parentId && (row.parentId ?? undefined) !== parentId) update.parentId = parentId
    if (update.name !== undefined || update.parentId !== undefined) updates.push(update)
  }
  // 上層先補，下層的上層才存在。
  inserts.sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)))
  const orphans = rows.filter(row => !used.has(row.id)).map(row => ({ id: row.id, name: row.name }))
  return { inserts, updates, orphans, skipped }
}
