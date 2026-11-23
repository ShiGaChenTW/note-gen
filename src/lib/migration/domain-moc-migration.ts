// Fork（almanac ALMNC-69.6）：領域資料表（note.db 的 domains）遷移成筆記庫裡的 MOC 檔。純函式：給一份「筆記庫＋domains 表＋id_index」
// 的快照，算出每個 MOC 檔的完整內容與要登記的系統索引，不碰任何檔案或資料庫。預覽與套用在 domain-moc-migration-cli.ts。
// 規格：almanac/2026-11-23_proposal_note-type-rules.md 第二節（資料放哪裡、MOC 五區塊、尚未分章）、GLOSSARY（MOC、章節、
// 正式收錄、主要領域）、範例 vault 的「20 領域/*.md」（格式以它為準）、差距報告 2.2～2.4。
//
// 做的事：
// 1. 每個領域（同名的幾列合成一個）寫成 `<領域資料夾>/<名稱>.md`：frontmatter id（id_index 已有的 M 編號；筆記庫已有同名 MOC 檔就
//    沿用它的編號；都沒有才產生）、kind: domain、level、parent: M-…（由 parent_id 對應上層的 M 編號）。
// 2. 內文是五區塊骨架（標題文字照範例 vault）；舊 overview 依 `##` 標題分段搬進對應區塊：總覽／核心概念 → ① 定位問題、
//    重點結論 → ④、矛盾與未解問題 → ⑤，其他段落放在 ① 底下並註明來源。
// 3. 舊的歸屬（知識筆記 frontmatter domains 列出這個領域，名稱或舊 dom_ id 都認）全部放進 ③ 的「尚未分章」，一則一行
//    `- [[筆記標題]]`（只有這一組可以沒有關係說明）。筆記 frontmatter 的 domains 不動，排第一個的仍是主要領域。
// 4. 歸屬數驗證：遷移前的歸屬數必須等於新 MOC 檔裡的收錄行數＋跳過的 MOC 的歸屬數，每個 MOC 的收錄行數也必須等於它的歸屬數；
//    對不上就寫進 errors，套用會拒絕。
// 5. 已經有同名檔：不覆寫。檔案 id 就是這個領域的 M 編號（上次遷移寫的，或 Scott 自己建的）→「已存在」跳過，只補登記索引；
//    其他 → 「衝突」跳過。所以可以重跑、不會重複。
// 6. domains 表本身不動（之後當索引快取，ALMNC-69.7 由 MOC 重建）；id_index 記 M 編號 ↔ MOC 路徑。
import { idStamp, isId, parseId, shortCode, type RandomSource } from '@/lib/v3-model/identity'
import { lastNameOf } from '@/lib/v3-model/id-index'
import { readFrontmatter, type IdIndexChange, type MigrationIdIndexRow, type MigrationNoteFile } from './id-migration'

// ── 快照 ────────────────────────────────────────────────────

export interface MigrationDomainFullRow {
  id: string
  name: string
  parentId?: string | null
  overview: string
  createdAt: number
}

export interface DomainMigrationSnapshot {
  notes: readonly MigrationNoteFile[]
  domains: readonly MigrationDomainFullRow[]
  idIndex: readonly MigrationIdIndexRow[]
}

export const DEFAULT_DOMAIN_FOLDER = '20 領域'

export interface DomainMigrationOptions {
  random?: RandomSource
  /** 現在時間（毫秒）；章節 C 編號用它，領域建立時間晚於現在時也改用它。 */
  now?: number
  /** MOC 檔放的資料夾（筆記庫相對路徑），預設「20 領域」。 */
  folder?: string
}

// ── 五區塊標題（照範例 vault） ───────────────────────────────

export const MOC_HEADINGS = {
  position: '## ① 這個領域在回答什麼',
  start: '## ② 從這裡開始',
  chapters: '## ③ 章節',
  conclusions: '## ④ 重點結論',
  open: '## ⑤ 待釐清',
} as const

export const UNCHAPTERED_HEADING = '### 尚未分章'

type Block = 'position' | 'start' | 'conclusions' | 'open'

// 舊 overview 的段落標題 → 區塊（繁中、簡中、英文；也認新五區塊的標題，避免重複包一層說明）。
const OVERVIEW_TARGETS: ReadonlyArray<{ block: Block, label?: string, names: readonly string[] }> = [
  { block: 'position', names: ['總覽', '总览', 'overview', '① 這個領域在回答什麼', '定位問題'] },
  { block: 'position', label: '核心概念', names: ['核心概念', 'core concepts'] },
  { block: 'start', names: ['② 從這裡開始', '從這裡開始'] },
  { block: 'conclusions', names: ['重點結論', '重点结论', 'key conclusions', '④ 重點結論'] },
  { block: 'open', names: ['矛盾與未解問題', '矛盾与未解问题', 'contradictions and open questions', '⑤ 待釐清', '待釐清'] },
]

// ── 計畫 ────────────────────────────────────────────────────

export interface DomainMembership {
  notePath: string
  /** 收錄行的連結目標（檔名去掉 .md；同名檔有好幾個時用筆記庫相對路徑）。 */
  link: string
  /** 這個領域排在筆記 domains 第一個（主要領域）。 */
  primary: boolean
}

export type MocFileStatus = 'create' | 'exists' | 'conflict'

export interface OverviewMove {
  /** 舊 overview 的段落（「（標題前的文字）」代表第一個 `##` 之前）。 */
  from: string
  to: Block
}

export interface MocFilePlan {
  /** 合成這個 MOC 的 domains 列（同名的會有好幾列；第一個是最早建立的）。 */
  domainIds: string[]
  name: string
  /** 筆記庫相對路徑。 */
  path: string
  mocId: string
  mocIdSource: 'index' | 'vault' | 'new'
  level: 1 | 2
  parentMocId?: string
  parentName?: string
  status: MocFileStatus
  /** create 才有：要寫的完整檔案內容。 */
  content?: string
  /** exists／conflict：筆記庫裡那個檔的 frontmatter id（沒有就省略）。 */
  existingId?: string
  members: DomainMembership[]
  /** create：content 裡「尚未分章」的收錄行數（從產生的內容數回來，不是直接用 members.length）。 */
  memberLines: number
  overviewMoves: OverviewMove[]
}

export interface DomainMigrationStats {
  domainRows: number
  mocs: number
  mocsToCreate: number
  mocsExisting: number
  mocsConflict: number
  /** 遷移前的歸屬數：知識筆記 frontmatter domains 裡對得到領域的（筆記, 領域）組數。 */
  membershipsBefore: number
  /** 要寫的新 MOC 檔裡「尚未分章」的收錄行數合計。 */
  memberLinesWritten: number
  /** 已存在或衝突而跳過的 MOC 的歸屬數（不寫，維持在筆記 frontmatter）。 */
  membershipsSkipped: number
  primaryMemberships: number
}

export interface DomainMigrationPlan {
  folder: string
  mocs: MocFilePlan[]
  idIndex: IdIndexChange[]
  /** 套用時重算歸屬用（版本檢查）。 */
  domains: Array<{ id: string, name: string }>
  warnings: string[]
  /** 歸屬數對不上等嚴重問題；有任何一項就不能套用。 */
  errors: string[]
  stats: DomainMigrationStats
}

// ── 小工具 ──────────────────────────────────────────────────

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).trim()).filter(Boolean)
}

function validTime(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

const UNSAFE_FILENAME = /[\\/:*?"<>|#^[\]]/g

/** 領域名稱 → 檔名（不含 .md）：換掉檔名與 wikilink 不能用的字元。 */
export function mocFileName(name: string): string {
  const safe = oneLine(name).replace(UNSAFE_FILENAME, '-').replace(/^\.+/, '').trim()
  return safe || '未命名領域'
}

function noteBaseName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

function isKnowledge(data: Record<string, unknown>): boolean {
  return typeof data.type === 'string' && data.type.trim().toLowerCase() === 'knowledge'
}

// ── 歸屬 ────────────────────────────────────────────────────

export interface MembershipResult {
  /** 領域名稱 → 歸屬（依連結文字排序）。 */
  byName: Map<string, DomainMembership[]>
  total: number
  warnings: string[]
}

/**
 * 舊的歸屬：知識筆記（type: knowledge）frontmatter domains 列出的領域，名稱與舊 dom_ id 都認，同一則筆記同一個領域只算一次。
 * 排第一個（第一個對得到領域的）是主要領域。不是知識筆記的、對不到領域的只列警告，不算歸屬。
 */
export function collectMemberships(notes: readonly MigrationNoteFile[], domains: ReadonlyArray<Pick<MigrationDomainFullRow, 'id' | 'name'>>): MembershipResult {
  const nameOf = new Map<string, string>()
  for (const domain of domains) if (domain.name.trim() && !nameOf.has(domain.name.trim())) nameOf.set(domain.name.trim(), domain.name.trim())
  for (const domain of domains) if (domain.name.trim()) nameOf.set(domain.id, domain.name.trim())

  const baseCount = new Map<string, number>()
  for (const note of notes) {
    const key = noteBaseName(note.path).toLowerCase()
    baseCount.set(key, (baseCount.get(key) ?? 0) + 1)
  }

  const byName = new Map<string, DomainMembership[]>()
  const warnings: string[] = []
  let total = 0
  for (const note of notes) {
    let data: Record<string, unknown> | null
    try {
      data = readFrontmatter(note.raw)
    } catch {
      data = null
    }
    if (!data) continue
    const refs = stringList(data.domains)
    if (!refs.length) continue
    const resolved: string[] = []
    for (const ref of refs) {
      const name = nameOf.get(ref)
      if (!name) {
        warnings.push(`${note.path}：domains 的「${ref}」對不到任何領域，沒有收錄`)
        continue
      }
      if (!resolved.includes(name)) resolved.push(name)
    }
    if (!resolved.length) continue
    if (!isKnowledge(data)) {
      warnings.push(`${note.path}：不是知識筆記（type: ${typeof data.type === 'string' ? data.type : '—'}），domains 列了 ${resolved.join('、')}，不收進 MOC`)
      continue
    }
    const base = noteBaseName(note.path)
    const ambiguous = (baseCount.get(base.toLowerCase()) ?? 0) > 1
    if (ambiguous) warnings.push(`${note.path}：筆記庫裡有同名檔，收錄行改用路徑連結 [[${note.path.replace(/\.md$/i, '')}]]`)
    if (/[[\]|#^]/.test(base)) warnings.push(`${note.path}：檔名含有 wikilink 不能用的字元，收錄行可能連不到`)
    const link = ambiguous ? note.path.replace(/\.md$/i, '') : base
    resolved.forEach((name, index) => {
      const list = byName.get(name) ?? []
      list.push({ notePath: note.path, link, primary: index === 0 })
      byName.set(name, list)
      total++
    })
  }
  for (const list of byName.values()) list.sort((a, b) => a.link.localeCompare(b.link, 'zh-Hant') || a.notePath.localeCompare(b.notePath))
  return { byName, total, warnings }
}

// ── 舊 overview 分段 ─────────────────────────────────────────

export interface OverviewSection {
  /** null：第一個 `##` 之前的文字。 */
  heading: string | null
  body: string
}

/** 依 `##` 標題拆段（略過 code fence 裡的、開頭的 `# 領域名稱`）；各段保留原文。 */
export function splitOverview(overview: string): OverviewSection[] {
  const lines = overview.replace(/\r\n?/g, '\n').split('\n')
  const sections: Array<{ heading: string | null, lines: string[] }> = [{ heading: null, lines: [] }]
  let fence = false
  let sawContent = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h2 = fence ? null : /^##\s+(.*?)\s*#*\s*$/.exec(line)
    if (h2) {
      sections.push({ heading: h2[1].trim(), lines: [] })
      sawContent = true
      continue
    }
    if (!fence && !sawContent && sections.length === 1 && /^#\s/.test(line)) continue
    if (line.trim()) sawContent = true
    sections[sections.length - 1].lines.push(line)
  }
  return sections
    .map(section => ({ heading: section.heading, body: section.lines.join('\n').trim() }))
    .filter(section => section.heading !== null || section.body)
}

function targetOf(heading: string | null): { block: Block, label?: string, other: boolean } {
  if (heading === null) return { block: 'position', other: false }
  const key = heading.trim().toLowerCase()
  const found = OVERVIEW_TARGETS.find(target => target.names.some(name => name.toLowerCase() === key))
  return found ? { block: found.block, ...(found.label ? { label: found.label } : {}), other: false } : { block: 'position', label: heading.trim(), other: true }
}

/** 舊 overview → 各區塊的內容（Markdown）與搬移紀錄。 */
export function distributeOverview(overview: string): { blocks: Record<Block, string[]>, moves: OverviewMove[] } {
  const blocks: Record<Block, string[]> = { position: [], start: [], conclusions: [], open: [] }
  const moves: OverviewMove[] = []
  const others: string[] = []
  for (const section of splitOverview(overview)) {
    if (!section.body) continue
    const target = targetOf(section.heading)
    moves.push({ from: section.heading ?? '（標題前的文字）', to: target.block })
    if (target.other) {
      others.push(`**${oneLine(target.label!)}**（搬自舊總覽，沒有對應的區塊，暫放這裡）\n\n${section.body}`)
    } else if (target.label) {
      blocks[target.block].push(`**${target.label}**（搬自舊總覽）\n\n${section.body}`)
    } else {
      blocks[target.block].push(section.body)
    }
  }
  blocks.position.push(...others)
  return { blocks, moves }
}

// ── MOC 檔內容 ──────────────────────────────────────────────

export interface MocContentInput {
  name: string
  fileName: string
  mocId: string
  level: 1 | 2
  parent?: { mocId: string, name: string, fileName: string }
  children: Array<{ name: string, fileName: string }>
  overview: string
  chapterId: string
  members: readonly DomainMembership[]
  blueprint?: {
    ref: string
    exploring: boolean
    positioning: string
    chapters: readonly { id: string, question: string, entries: readonly { target: string, relation: string }[] }[]
  }
}

/** 一個 MOC 檔的完整內容（frontmatter＋五區塊骨架）。 */
export function renderMocContent(input: MocContentInput): { content: string, moves: OverviewMove[] } {
  const { blocks, moves } = distributeOverview(input.overview)
  const fm = ['---', `id: ${input.mocId}`]
  if (input.fileName !== oneLine(input.name)) fm.push(`title: ${JSON.stringify(oneLine(input.name))}`)
  fm.push('kind: domain', `level: ${input.level}`)
  if (input.blueprint) {
    fm.push(`blueprint_ref: ${JSON.stringify(input.blueprint.ref)}`)
    if (input.blueprint.exploring) fm.push('status: 探索中')
  }
  if (input.parent) fm.push(`parent: ${input.parent.mocId}   # ${oneLine(input.parent.name)}；存編號，改名不會斷`)
  fm.push('---')

  const out: string[] = [...fm, `# ${oneLine(input.name)}`, '']
  if (input.parent) out.push(`上層：[[${input.parent.fileName}]]`, '')
  else if (input.children.length) out.push(`下層：${input.children.map(child => `[[${child.fileName}]]`).join('、')}`, '')

  const section = (heading: string, parts: readonly string[], placeholder: string) => {
    out.push(heading, '')
    if (parts.length) out.push(parts.join('\n\n'), '')
    else out.push(placeholder, '')
  }
  section(MOC_HEADINGS.position, input.blueprint ? [input.blueprint.positioning] : blocks.position, '<!-- 定位問題還沒寫：舊總覽沒有內容，由專家（沒有專家時由指揮官）補上。 -->')
  const readingOrder = input.blueprint?.exploring ? input.blueprint.chapters.map((chapter, index) => `${index + 1}. ${chapter.question}`).join('\n') : undefined
  section(MOC_HEADINGS.start, readingOrder ? [readingOrder] : blocks.start, '<!-- 筆記滿 6 則後，由專家挑 3 則先讀的。 -->')

  out.push(MOC_HEADINGS.chapters, '')
  if (input.blueprint) {
    for (const chapter of input.blueprint.chapters) {
      out.push(`### ${chapter.question}`, `<!-- ${chapter.id} -->`)
      for (const entry of chapter.entries) out.push(`- [[${entry.target}]] ── ${entry.relation}`)
      if (input.blueprint.exploring && !chapter.entries.length) out.push('知識缺口：還沒有筆記')
      out.push('')
    }
  } else if (input.members.length) {
    out.push(UNCHAPTERED_HEADING, `<!-- ${input.chapterId} -->`)
    for (const member of input.members) out.push(`- [[${member.link}]]`)
    out.push('')
  } else {
    out.push('<!-- 還沒有收錄的筆記。 -->', '')
  }

  section(MOC_HEADINGS.conclusions, blocks.conclusions, '<!-- 每一句都附筆記連結；由專家在每週整理卡提案。 -->')
  section(MOC_HEADINGS.open, blocks.open, '<!-- 矛盾、未解、知識缺口，每項標來源；由專家在每週整理卡提案。 -->')
  return { content: `${out.join('\n').trimEnd()}\n`, moves }
}

/** 數 MOC 檔「③ 章節」底下「尚未分章」那一組的收錄行（`- [[…]]`）。驗證用：預覽數產生的內容，套用數寫完讀回的檔案。 */
export function countUnchapteredLines(content: string): number {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  let inChapters = false
  let inGroup = false
  let fence = false
  let count = 0
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    if (/^##\s/.test(line)) {
      inChapters = line.trim() === MOC_HEADINGS.chapters
      inGroup = false
      continue
    }
    if (/^###\s/.test(line)) {
      inGroup = inChapters && line.trim() === UNCHAPTERED_HEADING
      continue
    }
    if (inGroup && /^- \[\[[^\]\n]+\]\]\s*$/.test(line)) count++
  }
  return count
}

// ── 主函式 ─────────────────────────────────────────────────

interface DomainGroup {
  name: string
  rows: MigrationDomainFullRow[]
}

/** 算出領域 → MOC 檔的遷移計畫；不改輸入、不做任何 I/O。 */
export function planDomainMigration(snapshot: DomainMigrationSnapshot, options: DomainMigrationOptions = {}): DomainMigrationPlan {
  const now = options.now ?? Date.now()
  const folder = (options.folder ?? DEFAULT_DOMAIN_FOLDER).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const warnings: string[] = []
  const errors: string[] = []

  // 筆記庫的 frontmatter（找既有 MOC 檔、避開已用的編號）。
  const taken = new Set<string>(snapshot.idIndex.map(row => row.id))
  const vaultFiles = snapshot.notes.map(file => {
    let data: Record<string, unknown> | null = null
    try {
      data = readFrontmatter(file.raw)
    } catch {
      data = null
    }
    const id = data && typeof data.id === 'string' && isId(data.id) ? data.id : undefined
    if (id) taken.add(id)
    return { file, data, id }
  })
  const fileByPath = new Map(vaultFiles.map(entry => [entry.file.path, entry]))
  const pathById = new Map<string, string>()
  for (const entry of vaultFiles) if (entry.id && !pathById.has(entry.id)) pathById.set(entry.id, entry.file.path)

  const generate = (kind: 'M' | 'C', at: number): string => {
    const stamp = idStamp(new Date(Math.min(at, now)))
    for (let attempt = 0; attempt < 50; attempt++) {
      const id = `${kind}-${stamp}-${shortCode(options.random)}`
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
    }
    throw new Error(`編號連續撞號，放棄產生（${kind} ${stamp}）`)
  }

  // ── 領域分組（同名合一，和 ALMNC-69.4 共用 M 編號的做法一致） ──
  const sortedRows = [...snapshot.domains].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const groups: DomainGroup[] = []
  const groupByName = new Map<string, DomainGroup>()
  for (const row of sortedRows) {
    const name = oneLine(row.name)
    if (!name) {
      warnings.push(`領域 ${row.id} 沒有名稱，沒有遷移`)
      continue
    }
    const existing = groupByName.get(name)
    if (existing) {
      warnings.push(`領域 ${row.id} 與 ${existing.rows[0].id} 同名「${name}」，合成同一個 MOC 檔`)
      existing.rows.push(row)
      if (row.overview.trim() && row.overview.trim() !== existing.rows[0].overview.trim()) {
        warnings.push(`領域 ${row.id} 的總覽和 ${existing.rows[0].id} 不同，只搬了 ${existing.rows[0].id} 的；請手動對照`)
      }
      continue
    }
    const group = { name, rows: [row] }
    groups.push(group)
    groupByName.set(name, group)
  }
  const nameById = new Map<string, string>()
  for (const group of groups) for (const row of group.rows) nameById.set(row.id, group.name)

  // ── M 編號：id_index（名稱）→ 筆記庫既有 MOC 檔（title 或檔名）→ 產生 ──
  const indexByName = new Map<string, MigrationIdIndexRow>()
  for (const row of snapshot.idIndex) if (row.kind === 'M' && row.name?.trim() && !indexByName.has(row.name.trim())) indexByName.set(row.name.trim(), row)
  const indexById = new Map(snapshot.idIndex.map(row => [row.id, row]))
  const vaultMocByName = new Map<string, string>()
  for (const entry of vaultFiles) {
    if (!entry.id || !isId(entry.id, 'M') || !entry.data) continue
    const name = (typeof entry.data.title === 'string' && entry.data.title.trim()) || lastNameOf(entry.file.path)
    if (!vaultMocByName.has(name)) vaultMocByName.set(name, entry.id)
  }
  const mocIdOf = new Map<string, { id: string, source: MocFilePlan['mocIdSource'] }>()
  for (const group of groups) {
    const indexed = indexByName.get(group.name)
    if (indexed) mocIdOf.set(group.name, { id: indexed.id, source: 'index' })
    else if (vaultMocByName.has(group.name)) mocIdOf.set(group.name, { id: vaultMocByName.get(group.name)!, source: 'vault' })
    else {
      const at = validTime(group.rows[0].createdAt) ? group.rows[0].createdAt : now
      mocIdOf.set(group.name, { id: generate('M', at), source: 'new' })
    }
  }

  // ── 上下層 ──
  const parentNameOf = new Map<string, string>()
  for (const group of groups) {
    const parentId = group.rows.map(row => row.parentId).find(Boolean)
    if (!parentId) continue
    const parentName = nameById.get(parentId)
    if (!parentName) {
      warnings.push(`領域「${group.name}」的上層 ${parentId} 不在領域表，當成第一層`)
      continue
    }
    if (parentName === group.name) {
      warnings.push(`領域「${group.name}」的上層是自己，當成第一層`)
      continue
    }
    parentNameOf.set(group.name, parentName)
  }
  for (const [child, parent] of parentNameOf) {
    if (parentNameOf.has(parent)) warnings.push(`領域「${child}」的上層「${parent}」本身也有上層，超過兩層；照樣寫 level: 2，請手動調整`)
  }
  const fileNameOf = new Map(groups.map(group => [group.name, mocFileName(group.name)]))
  for (const group of groups) {
    if (fileNameOf.get(group.name) !== group.name) warnings.push(`領域「${group.name}」含有檔名不能用的字元，檔名改成「${fileNameOf.get(group.name)}」，frontmatter 另寫 title`)
  }
  const pathSeen = new Map<string, string>()

  // ── 歸屬 ──
  const memberships = collectMemberships(snapshot.notes, snapshot.domains)
  warnings.push(...memberships.warnings)

  // ── 每個 MOC ──
  const mocs: MocFilePlan[] = []
  const idIndex: IdIndexChange[] = []
  const register = (mocId: string, name: string, path: string) => {
    const indexed = indexById.get(mocId)
    if (!indexed) {
      idIndex.push({ action: 'insert', id: mocId, kind: 'M', name, path, createdAt: parseId(mocId)?.at.getTime() ?? now })
    } else if ((indexed.path ?? '') !== path) {
      idIndex.push({ action: 'update_path', id: mocId, kind: 'M', name, path, createdAt: parseId(mocId)?.at.getTime() ?? now, ...(indexed.path ? { previousPath: indexed.path } : {}) })
    }
  }
  for (const group of groups) {
    const { id: mocId, source } = mocIdOf.get(group.name)!
    const fileName = fileNameOf.get(group.name)!
    let path = `${folder ? `${folder}/` : ''}${fileName}.md`
    const clash = pathSeen.get(path.toLowerCase())
    if (clash) {
      warnings.push(`領域「${group.name}」和「${clash}」的檔名相同（${path}），改用「${fileName} (${group.rows[0].id})」`)
      path = `${folder ? `${folder}/` : ''}${fileName} (${mocFileName(group.rows[0].id)}).md`
    }
    pathSeen.set(path.toLowerCase(), group.name)
    const parentName = parentNameOf.get(group.name)
    const parentMocId = parentName ? mocIdOf.get(parentName)!.id : undefined
    const members = memberships.byName.get(group.name) ?? []
    const base: Omit<MocFilePlan, 'status' | 'memberLines' | 'overviewMoves'> = {
      domainIds: group.rows.map(row => row.id),
      name: group.name,
      path,
      mocId,
      mocIdSource: source,
      level: parentName ? 2 : 1,
      ...(parentMocId ? { parentMocId, parentName } : {}),
      members,
    }

    // 已經有檔：同 M 編號＝已存在（上次遷移寫的或 Scott 建的），否則衝突。都不覆寫。
    const atPath = [...fileByPath.values()].find(entry => entry.file.path.toLowerCase() === path.toLowerCase())
    const elsewhere = pathById.get(mocId)
    if (atPath || elsewhere) {
      const existingPath = atPath ? atPath.file.path : elsewhere!
      const existingId = atPath ? atPath.id : mocId
      const status: MocFileStatus = existingId === mocId ? 'exists' : 'conflict'
      mocs.push({ ...base, path: existingPath, status, ...(existingId ? { existingId } : {}), memberLines: 0, overviewMoves: [] })
      if (status === 'exists') register(mocId, group.name, existingPath)
      else warnings.push(`「${existingPath}」已經存在（id ${existingId ?? '沒有'}，不是領域「${group.name}」的 ${mocId}），不覆寫，跳過這個領域`)
      continue
    }

    const children = groups
      .filter(other => parentNameOf.get(other.name) === group.name)
      .map(other => ({ name: other.name, fileName: fileNameOf.get(other.name)! }))
    const { content, moves } = renderMocContent({
      name: group.name,
      fileName,
      mocId,
      level: base.level,
      ...(parentName ? { parent: { mocId: parentMocId!, name: parentName, fileName: fileNameOf.get(parentName)! } } : {}),
      children,
      overview: group.rows[0].overview,
      chapterId: members.length ? generate('C', now) : '',
      members,
    })
    const memberLines = countUnchapteredLines(content)
    if (memberLines !== members.length) errors.push(`${path}：歸屬 ${members.length} 則，但產生的「尚未分章」收錄行有 ${memberLines} 行`)
    mocs.push({ ...base, status: 'create', content, memberLines, overviewMoves: moves })
    register(mocId, group.name, path)
  }

  for (const moc of mocs) {
    if (moc.status !== 'create' || !moc.parentName) continue
    const parent = mocs.find(other => other.name === moc.parentName)
    if (parent?.status === 'conflict') warnings.push(`${moc.path}：上層「${moc.parentName}」衝突沒有寫，parent ${moc.parentMocId} 暫時找不到檔案`)
  }

  // ── 歸屬數驗證 ──
  const memberLinesWritten = mocs.filter(moc => moc.status === 'create').reduce((sum, moc) => sum + moc.memberLines, 0)
  const membershipsSkipped = mocs.filter(moc => moc.status !== 'create').reduce((sum, moc) => sum + moc.members.length, 0)
  const membershipsInMocs = mocs.reduce((sum, moc) => sum + moc.members.length, 0)
  if (membershipsInMocs !== memberships.total) errors.push(`遷移前歸屬 ${memberships.total} 組，分到各 MOC 的只有 ${membershipsInMocs} 組`)
  if (memberLinesWritten + membershipsSkipped !== memberships.total) {
    errors.push(`遷移前歸屬數 ${memberships.total} ≠ 遷移後收錄行數 ${memberLinesWritten}＋跳過 ${membershipsSkipped}`)
  }

  return {
    folder,
    mocs,
    idIndex,
    domains: sortedRows.map(row => ({ id: row.id, name: row.name })),
    warnings,
    errors,
    stats: {
      domainRows: snapshot.domains.length,
      mocs: mocs.length,
      mocsToCreate: mocs.filter(moc => moc.status === 'create').length,
      mocsExisting: mocs.filter(moc => moc.status === 'exists').length,
      mocsConflict: mocs.filter(moc => moc.status === 'conflict').length,
      membershipsBefore: memberships.total,
      memberLinesWritten,
      membershipsSkipped,
      primaryMemberships: mocs.reduce((sum, moc) => sum + moc.members.filter(member => member.primary).length, 0),
    },
  }
}

/** 計畫是不是什麼都不用做（重跑時應該是）。 */
export function isEmptyDomainPlan(plan: DomainMigrationPlan): boolean {
  return !plan.mocs.some(moc => moc.status === 'create') && !plan.idIndex.length
}

// ── 預覽報告 ─────────────────────────────────────────────────

const STATUS_LABEL: Record<MocFileStatus, string> = {
  create: '新建',
  exists: '已存在（跳過，不覆寫）',
  conflict: '衝突（跳過，不覆寫）',
}

const BLOCK_LABEL: Record<Block, string> = {
  position: '① 定位問題',
  start: '② 從這裡開始',
  conclusions: '④ 重點結論',
  open: '⑤ 待釐清',
}

const SOURCE_LABEL: Record<MocFilePlan['mocIdSource'], string> = {
  index: '系統索引已有',
  vault: '筆記庫已有同名 MOC 檔',
  new: '新產生（領域建立時間）',
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function utc(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

export interface DomainReportContext {
  vault?: string
  db?: string
  generatedAt?: number
  title?: string
  /** 套用時：跳過的項目。 */
  skipped?: string[]
  /** 套用時：實際寫入後讀回數到的數字。 */
  applied?: { membershipsBefore: number, memberLinesWritten: number, mocsWritten: number }
}

/** 預覽（或套用結果）的 Markdown：統計、歸屬數驗證、每個 MOC 的摘要與完整檔案內容。 */
export function renderDomainMigrationReport(plan: DomainMigrationPlan, context: DomainReportContext = {}): string {
  const s = plan.stats
  const lines: string[] = []
  lines.push(`# ${context.title ?? '領域資料表遷移成 MOC 檔預覽（ALMNC-69.6）'}`, '')
  if (context.generatedAt) lines.push(`- 產生時間：${utc(context.generatedAt)}`)
  if (context.vault) lines.push(`- 筆記庫：\`${context.vault}\``)
  if (context.db) lines.push(`- note.db：\`${context.db}\``)
  lines.push(`- MOC 資料夾：\`${plan.folder || '（筆記庫根目錄）'}\``)
  lines.push('- 編號時間一律 UTC。domains 表不動；筆記 frontmatter 的 domains 不動（排第一個的仍是主要領域）。這份預覽沒有改任何檔案或資料庫。', '')
  if (isEmptyDomainPlan(plan)) lines.push('**沒有需要遷移的項目**（已經遷移過，或沒有領域）。', '')

  lines.push('## 歸屬數驗證', '')
  const ok = !plan.errors.length
  lines.push(`- 遷移前歸屬數（知識筆記 domains 對得到領域的組數）：**${s.membershipsBefore}**`)
  lines.push(`- 遷移後收錄行數（新 MOC 檔「尚未分章」）：**${s.memberLinesWritten}**`)
  if (s.membershipsSkipped) lines.push(`- 跳過的 MOC（已存在或衝突）的歸屬數：**${s.membershipsSkipped}**（不寫，仍在筆記 frontmatter）`)
  lines.push(`- 結果：${ok ? `✅ ${s.membershipsBefore} = ${s.memberLinesWritten}${s.membershipsSkipped ? `＋${s.membershipsSkipped}` : ''}` : '❌ 對不上，這份計畫不能套用'}`)
  if (context.applied) {
    const a = context.applied
    lines.push(`- 套用後讀回：遷移前歸屬數 ${a.membershipsBefore}、寫入的 ${a.mocsWritten} 個 MOC 檔收錄行數 ${a.memberLinesWritten}${a.membershipsBefore === a.memberLinesWritten ? '（相等）' : '（**不相等**）'}`)
  }
  lines.push('')

  lines.push('## 統計', '', '| 項目 | 數量 |', '|---|---|')
  const rows: Array<[string, number]> = [
    ['domains 列', s.domainRows],
    ['MOC（同名合一）', s.mocs],
    ['　新建', s.mocsToCreate],
    ['　已存在（跳過）', s.mocsExisting],
    ['　衝突（跳過）', s.mocsConflict],
    ['歸屬（筆記, 領域）', s.membershipsBefore],
    ['　其中是筆記的主要領域', s.primaryMemberships],
    ['id_index 新增／更新路徑', plan.idIndex.length],
    ['警告', plan.warnings.length],
    ['錯誤', plan.errors.length],
  ]
  for (const [label, count] of rows) lines.push(`| ${label} | ${count} |`)
  lines.push('')

  if (plan.errors.length) {
    lines.push('## 錯誤（不能套用）', '')
    for (const error of plan.errors) lines.push(`- ${error}`)
    lines.push('')
  }
  if (context.skipped?.length) {
    lines.push('## 套用時跳過', '')
    for (const item of context.skipped) lines.push(`- ${item}`)
    lines.push('')
  }
  if (plan.warnings.length) {
    lines.push('## 警告', '')
    for (const warning of plan.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }

  if (plan.mocs.length) {
    lines.push('## MOC 一覽', '', '| 檔案 | 狀態 | M 編號（來源） | 層級／上層 | 尚未分章 | 主要 | 舊 domains 列 |', '|---|---|---|---|---|---|---|')
    for (const moc of plan.mocs) {
      const level = moc.parentName ? `2／${moc.parentName}（${moc.parentMocId}）` : '1'
      const members = moc.status === 'create' ? `${moc.memberLines}` : `（${moc.members.length} 則不寫）`
      lines.push(`| ${cell(moc.path)} | ${STATUS_LABEL[moc.status]}${moc.status === 'conflict' ? `：檔案 id ${moc.existingId ?? '沒有'}` : ''} | ${moc.mocId}（${SOURCE_LABEL[moc.mocIdSource]}） | ${cell(level)} | ${members} | ${moc.members.filter(member => member.primary).length} | ${cell(moc.domainIds.join(', '))} |`)
    }
    lines.push('')
  }

  if (plan.idIndex.length) {
    lines.push('## 系統索引（id_index）', '', '| 動作 | M 編號 | 名稱 | 路徑 |', '|---|---|---|---|')
    for (const change of plan.idIndex) {
      lines.push(`| ${change.action === 'insert' ? '新增' : '更新路徑'} | ${change.id} | ${cell(change.name ?? '')} | ${cell(`${change.previousPath ? `${change.previousPath} → ` : ''}${change.path ?? ''}`)} |`)
    }
    lines.push('')
  }

  const created = plan.mocs.filter(moc => moc.status === 'create')
  if (created.length) {
    lines.push('## 每個 MOC 的完整內容', '')
    for (const moc of created) {
      lines.push(`### ${moc.path}`, '')
      if (moc.overviewMoves.length) {
        lines.push(`舊總覽搬移：${moc.overviewMoves.map(move => `「${move.from}」→ ${BLOCK_LABEL[move.to]}`).join('；')}`, '')
      } else {
        lines.push('舊總覽：沒有內容。', '')
      }
      const fence = moc.content!.includes('````') ? '``````' : '````'
      lines.push(`${fence}markdown`, moc.content!.trimEnd(), fence, '')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}
