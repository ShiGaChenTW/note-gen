// Fork（almanac ALMNC-54.1）：第三層「領域」——最多兩層（例如「工程 › 資料工程」），一則筆記可屬於多個領域。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第一節 §3。純函式；SQL 在 src/db/v3-domains.ts。

export const MAX_DOMAIN_DEPTH = 2

export interface Domain {
  id: string
  name: string
  /** 上層領域；頂層沒有。 */
  parentId?: string
  /** 總覽（Markdown）；核心概念、重點結論等其餘組成之後由專家寫入。 */
  overview: string
  createdAt: number
  updatedAt: number
}

export interface DomainRow {
  id: string
  name: string
  parentId: string | null
  overview: string
  createdAt: number
  updatedAt: number
}

export function domainFromRow(row: DomainRow): Domain {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? undefined,
    overview: row.overview,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * 驗證某個領域（新建或改上層）放到 parentId 底下是否合法；合法回傳 null，否則回傳原因。
 * 規則：上層必須存在、不能是自己、上層本身必須是頂層，有下層的領域不能再被放到別人底下。
 */
export function domainPlacementError(
  domains: readonly Pick<Domain, 'id' | 'parentId'>[],
  domain: { id: string; parentId?: string }
): string | null {
  if (!domain.parentId) return null
  if (domain.parentId === domain.id) return '領域不能是自己的上層'
  const parent = domains.find(item => item.id === domain.parentId)
  if (!parent) return '上層領域不存在'
  if (parent.parentId) return `領域最多只能分 ${MAX_DOMAIN_DEPTH} 層`
  if (domains.some(item => item.parentId === domain.id)) return `這個領域已有下層，放到別的領域底下會超過 ${MAX_DOMAIN_DEPTH} 層`
  return null
}

export function assertDomainPlacement(domains: readonly Pick<Domain, 'id' | 'parentId'>[], domain: { id: string; parentId?: string }): void {
  const error = domainPlacementError(domains, domain)
  if (error) throw new Error(error)
}

/** 顯示用路徑，例如「工程 › 資料工程」。 */
export function domainPath(domains: readonly Pick<Domain, 'id' | 'name' | 'parentId'>[], id: string): string | undefined {
  const domain = domains.find(item => item.id === id)
  if (!domain) return undefined
  const parent = domain.parentId ? domains.find(item => item.id === domain.parentId) : undefined
  return parent ? `${parent.name} › ${domain.name}` : domain.name
}

/** 筆記 frontmatter 裡列的領域，哪些不存在於領域表。 */
export function unknownDomainIds(noteDomainIds: readonly string[], domains: readonly Pick<Domain, 'id'>[]): string[] {
  const known = new Set(domains.map(domain => domain.id))
  return noteDomainIds.filter(id => !known.has(id))
}
