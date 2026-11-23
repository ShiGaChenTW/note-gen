// Fork（almanac ALMNC-54.1）：V3 領域表（note.db）。最多兩層的規則在 src/lib/v3-model/domain.ts 驗證後才寫入。
// 筆記屬於哪些領域：ALMNC-69.7 起以 MOC 檔章節區的正式收錄為唯一依據（lib/moc），筆記 frontmatter 的 domains 由收錄重建；
// 這張表退成索引快取（syncDomainsTableFromMocs 由 MOC 檔重建），不再是權威。
// 每個領域的 M 編號記在系統索引 id_index（kind M、name＝領域名稱）；由 MOC 補進來的列 id 就是 M 編號，舊列仍是 dom_…。
import { getDb } from './index'
import { initIdIndexDb } from './id-index'
import { assertDomainPlacement, domainFromRow, domainPlacementError, type Domain, type DomainRow } from '@/lib/v3-model/domain'
import { planDomainsTableSync, type DomainsSyncPlan } from '@/lib/moc/domains-sync'
import type { ParsedMoc } from '@/lib/moc/parse'

const COLUMNS = 'id, name, parent_id as parentId, overview, created_at as createdAt, updated_at as updatedAt'

let initialized: Promise<void> | null = null

export function initV3DomainDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists domains (
          id text primary key,
          name text not null,
          parent_id text,
          overview text not null default '',
          created_at integer not null,
          updated_at integer not null
        )
      `)
      await db.execute('create index if not exists idx_domains_parent on domains(parent_id)')
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

export async function listDomains(): Promise<Domain[]> {
  await initV3DomainDb()
  const db = await getDb()
  const rows = await db.select<DomainRow[]>(`select ${COLUMNS} from domains order by name`)
  return rows.map(domainFromRow)
}

export async function addDomain(input: { id?: string; name: string; parentId?: string; overview?: string }, now = Date.now()): Promise<Domain> {
  const domain: Domain = {
    id: input.id ?? `dom_${crypto.randomUUID()}`,
    name: input.name.trim(),
    parentId: input.parentId || undefined,
    overview: input.overview ?? '',
    createdAt: now,
    updatedAt: now,
  }
  if (!domain.name) throw new Error('領域名稱不可為空')
  assertDomainPlacement(await listDomains(), domain)
  const db = await getDb()
  await db.execute(
    'insert into domains (id, name, parent_id, overview, created_at, updated_at) values ($1, $2, $3, $4, $5, $6)',
    [domain.id, domain.name, domain.parentId ?? null, domain.overview, domain.createdAt, domain.updatedAt]
  )
  return domain
}

export async function updateDomain(id: string, patch: { name?: string; parentId?: string | null; overview?: string }, now = Date.now()): Promise<Domain> {
  const domains = await listDomains()
  const current = domains.find(domain => domain.id === id)
  if (!current) throw new Error(`找不到領域：${id}`)
  const next: Domain = {
    ...current,
    name: patch.name?.trim() ?? current.name,
    parentId: patch.parentId === undefined ? current.parentId : patch.parentId || undefined,
    overview: patch.overview ?? current.overview,
    updatedAt: now,
  }
  if (!next.name) throw new Error('領域名稱不可為空')
  assertDomainPlacement(domains, next)
  const db = await getDb()
  await db.execute(
    'update domains set name = $2, parent_id = $3, overview = $4, updated_at = $5 where id = $1',
    [next.id, next.name, next.parentId ?? null, next.overview, next.updatedAt]
  )
  // Fork（almanac ALMNC-69.4）：系統索引以名稱記「領域 ↔ M 編號」（遷移時登記，ALMNC-69.6 寫 MOC 檔時沿用），改名要跟著改。
  if (next.name !== current.name) {
    await initIdIndexDb()
    await db.execute("update id_index set name = $2, updated_at = $3 where kind = 'M' and name = $1", [current.name, next.name, now])
  }
  return next
}

/**
 * Fork（almanac ALMNC-69.7）：domains 表退成索引快取，由 MOC 檔重建：補上有 MOC 檔但表裡沒有的領域（id＝M 編號）、
 * 同步名稱與上層。沒有 MOC 檔的舊列不刪（只回報）。違反兩層規則的上層不套用（新列先放頂層），其餘照做。
 */
export async function syncDomainsTableFromMocs(mocs: readonly Pick<ParsedMoc, 'id' | 'name' | 'parent' | 'path'>[], now = Date.now()): Promise<DomainsSyncPlan> {
  const current = await listDomains()
  const plan = planDomainsTableSync(mocs, current)
  if (!plan.inserts.length && !plan.updates.length) return plan
  const db = await getDb()
  const working: Array<Pick<Domain, 'id' | 'parentId'>> = current.map(domain => ({ id: domain.id, parentId: domain.parentId }))
  for (const insert of plan.inserts) {
    const error = domainPlacementError(working, { id: insert.id, parentId: insert.parentId })
    const parentId = error ? undefined : insert.parentId
    if (error) console.warn('[domains] 由 MOC 補列時上層不合法，先放頂層：', insert.name, error)
    await db.execute(
      'insert into domains (id, name, parent_id, overview, created_at, updated_at) values ($1, $2, $3, $4, $5, $6) on conflict(id) do nothing',
      [insert.id, insert.name, parentId ?? null, '', now, now]
    )
    working.push({ id: insert.id, parentId })
  }
  for (const update of plan.updates) {
    let parentId = update.parentId
    const row = working.find(item => item.id === update.id)
    if (parentId !== undefined && row) {
      const error = domainPlacementError(working, { id: update.id, parentId: parentId ?? undefined })
      if (error) {
        console.warn('[domains] 由 MOC 同步上層不合法，略過：', update.id, error)
        parentId = undefined
      } else {
        row.parentId = parentId ?? undefined
      }
    }
    if (update.name === undefined && parentId === undefined) continue
    const sets: string[] = []
    const values: unknown[] = [update.id]
    if (update.name !== undefined) { values.push(update.name); sets.push(`name = $${values.length}`) }
    if (parentId !== undefined) { values.push(parentId); sets.push(`parent_id = $${values.length}`) }
    values.push(now)
    sets.push(`updated_at = $${values.length}`)
    await db.execute(`update domains set ${sets.join(', ')} where id = $1`, values)
  }
  return plan
}

/** 撤回 MOC 時清除其快取列，同時解除指向這一列的快取上層。 */
export async function removeDomainCache(id: string): Promise<void> {
  await initV3DomainDb()
  const db = await getDb()
  await db.execute('update domains set parent_id = null where parent_id = $1', [id])
  await db.execute('delete from domains where id = $1', [id])
}
