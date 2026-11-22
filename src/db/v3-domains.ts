// Fork（almanac ALMNC-54.1）：V3 領域表（note.db）。最多兩層的規則在 src/lib/v3-model/domain.ts 驗證後才寫入。
// 筆記屬於哪些領域寫在筆記 frontmatter 的 domains（領域 id），這張表只存領域本身。
import { getDb } from './index'
import { assertDomainPlacement, domainFromRow, type Domain, type DomainRow } from '@/lib/v3-model/domain'

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
  return next
}
