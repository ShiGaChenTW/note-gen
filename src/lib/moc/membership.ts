// Fork（almanac ALMNC-69.7）：正式收錄 → 每則筆記的 domains。純函式。
// 規則（判斷規則提案第二節〈資料放哪裡〉〈歸屬數量〉）：
// - 筆記 domains 的**成員**一律由 MOC 章節區的正式收錄重建，存領域名稱；手動加減成員不算數。
// - **順序**由 Scott 決定：還在的照原位、新加的接在後面、被移除的拿掉；排第一個是主要領域，主要被移除時下一個自動遞補。
// - 最多 3 個領域（整筆操作完成後計）；超過時回報，不自動砍，由 Scott 在工作台選要拿掉哪個。
import { formalEntries, type ParsedMoc } from './parse'

export const MAX_DOMAINS = 3

export interface DomainRebuild {
  /** 重建後的 domains（第一個是主要領域）。 */
  domains: string[]
  /** 超過上限（預設 3 個）。 */
  overLimit: boolean
  added: string[]
  removed: string[]
}

function unique(list: readonly string[]): string[] {
  const out: string[] = []
  for (const item of list) {
    const value = item.trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

/**
 * 依收錄重建 domains：oldOrder 是筆記上現有的順序，memberships 是這則筆記目前被收錄的領域（新加的照這個順序接在後面）。
 * 主要領域（第一個）被移除時，下一個留下來的自然變成第一個。
 */
export function rebuildDomains(oldOrder: readonly string[], memberships: readonly string[], limit = MAX_DOMAINS): DomainRebuild {
  const old = unique(oldOrder)
  const members = unique(memberships)
  const set = new Set(members)
  const kept = old.filter(name => set.has(name))
  const added = members.filter(name => !kept.includes(name))
  const domains = [...kept, ...added]
  return { domains, overLimit: domains.length > limit, added, removed: old.filter(name => !set.has(name)) }
}

// ── MOC → 筆記 ──────────────────────────────────────────────

/** 收錄的連結目標 → 筆記庫相對路徑；連不到回傳 null。mocPath 給相對路徑連結用。 */
export type ResolveTarget = (target: string, mocPath: string | undefined) => string | null

export interface MocMemberships {
  /** 筆記（有 resolve 時是路徑，否則是連結目標）→ 領域名稱，依 MOC 順序、不重複。 */
  byNote: Map<string, string[]>
  /** 連不到筆記的收錄（斷鏈；不算歸屬）。 */
  unresolved: Array<{ moc: string, target: string, line: number }>
  /** 兩個以上 MOC 檔同名（合在一起算）。 */
  duplicateNames: string[]
}

/**
 * 正式收錄 → 每則筆記屬於哪些領域。只算章節區的正式收錄：分家清單、帶「X MOC」標記的、從這裡開始／重點結論／待釐清裡的連結都不算。
 * 一則筆記可以在好幾個 MOC。
 */
export function membershipsFromMocs(mocs: readonly ParsedMoc[], resolve?: ResolveTarget): MocMemberships {
  const byNote = new Map<string, string[]>()
  const unresolved: MocMemberships['unresolved'] = []
  const names = new Map<string, number>()
  for (const moc of mocs) {
    const name = moc.name.trim()
    if (!name) continue
    names.set(name, (names.get(name) ?? 0) + 1)
    for (const { entry } of formalEntries(moc)) {
      const key = resolve ? resolve(entry.target, moc.path) : entry.target
      if (!key) {
        unresolved.push({ moc: moc.path ?? name, target: entry.target, line: entry.line })
        continue
      }
      const list = byNote.get(key) ?? []
      if (!list.includes(name)) list.push(name)
      byNote.set(key, list)
    }
  }
  return { byNote, unresolved, duplicateNames: [...names].filter(([, count]) => count > 1).map(([name]) => name) }
}

// ── 整批重建計畫 ─────────────────────────────────────────────

export interface RebuildNoteInput {
  path: string
  /** 筆記 frontmatter 現有的 domains（名稱，或還沒遷移的舊 dom_ id）。 */
  domains: readonly string[]
}

export interface DomainRebuildOptions {
  /** 有 MOC 檔的領域名稱。只有這些由收錄決定；其他名稱（找不到 MOC 檔的舊領域）原樣保留，不因為沒有收錄就被拿掉。 */
  managed: ReadonlySet<string>
  /** 舊 dom_ id → 領域名稱（domains 表）；對到有 MOC 的領域時改寫成名稱。 */
  aliases?: ReadonlyMap<string, string>
  /** 新加的領域依這個順序接在後面（例如提案列的順序，第一個成為主要）；其他依 MOC 順序。 */
  orderHint?: ReadonlyMap<string, readonly string[]>
  limit?: number
}

export interface NoteDomainChange {
  path: string
  before: string[]
  after: string[]
  added: string[]
  removed: string[]
}

export interface DomainRebuildPlan {
  /** 要寫回的筆記（只列有變化、沒超過上限的）。 */
  changes: NoteDomainChange[]
  /** 超過上限的筆記：after 是全部收錄，等 Scott 選要拿掉哪個，這次不寫。 */
  overLimit: NoteDomainChange[]
}

function hinted(members: readonly string[], hint: readonly string[] | undefined): string[] {
  if (!hint?.length) return [...members]
  const rank = (name: string) => {
    const index = hint.indexOf(name)
    return index < 0 ? hint.length : index
  }
  return members.map((name, index) => ({ name, index })).sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index).map(item => item.name)
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/**
 * 算出哪些筆記的 domains 要改。notes 要包含：所有可能有 domains 的筆記（例如全部知識筆記）＋被收錄的筆記。
 * 被收錄、但不在 notes 裡的路徑會被略過（呼叫端沒讀到）。
 */
export function planDomainRebuild(notes: readonly RebuildNoteInput[], byNote: ReadonlyMap<string, readonly string[]>, options: DomainRebuildOptions): DomainRebuildPlan {
  const changes: NoteDomainChange[] = []
  const overLimit: NoteDomainChange[] = []
  const seen = new Set<string>()
  for (const note of notes) {
    if (seen.has(note.path)) continue
    seen.add(note.path)
    const before = unique(note.domains)
    // 舊 dom_ id 對到有 MOC 的領域才換成名稱；其餘原樣，避免碰到沒有 MOC 的舊資料。
    const canonical = unique(before.map(ref => {
      const name = options.aliases?.get(ref)
      return name && options.managed.has(name) ? name : ref
    }))
    const managedOld = canonical.filter(name => options.managed.has(name))
    const unmanaged = canonical.filter(name => !options.managed.has(name))
    const members = hinted((byNote.get(note.path) ?? []).filter(name => options.managed.has(name)), options.orderHint?.get(note.path))
    const managed = rebuildDomains(managedOld, members, options.limit)
    const after = rebuildDomains(canonical, [...managed.domains, ...unmanaged]).domains
    const change = { path: note.path, before, after, added: managed.added, removed: managed.removed }
    if (managed.overLimit) overLimit.push(change)
    else if (!sameList(note.domains.map(item => item.trim()).filter(Boolean), after)) changes.push(change)
  }
  return { changes, overLimit }
}
