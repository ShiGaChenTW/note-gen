// Fork（almanac ALMNC-69.6）：領域資料表遷移成 MOC 檔的終端機入口（App 外執行，直接讀筆記庫資料夾與 note.db）。
// 由 scripts/migrate-domains.mjs 用 esbuild 打包後執行；App 不會 import 這個檔（用到 node:fs、node:sqlite）。參數形式同 migrate-ids。
//
//   預覽（只讀）：node scripts/migrate-domains.mjs --vault <筆記庫> --db <note.db> --preview <預覽.md> [--folder "20 領域"]
//               另外寫出 <預覽>.plan.json（套用時用的計畫，含每個 MOC 檔的完整內容）。
//   套用：      node scripts/migrate-domains.mjs --vault <筆記庫> --db <note.db> --apply --plan <預覽>.plan.json --backup-dir <備份資料夾>
//               --backup-dir 必須已存在且含 note.db 備份，否則拒絕；計畫有錯誤（歸屬數對不上）也拒絕。
//               每個 MOC：重算歸屬和計畫比對（版本檢查）、目標檔已存在就跳過（獨佔建立，不覆寫）、寫完讀回數收錄行數；
//               最後一個交易登記 id_index（只登記真的寫成或已存在的）。domains 表不動。套用前請先關閉 App。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isId } from '@/lib/v3-model/identity'
import { lastNameOf } from '@/lib/v3-model/id-index'
import {
  DEFAULT_DOMAIN_FOLDER,
  collectMemberships,
  countUnchapteredLines,
  planDomainMigration,
  renderDomainMigrationReport,
  type DomainMigrationPlan,
  type DomainMigrationSnapshot,
} from './domain-moc-migration'
import { checkBackup, columnsOf, openDatabase, readVaultNotes, tableExists, writeAtomic, type DatabaseSync } from './id-migration-cli'

// ── 參數 ────────────────────────────────────────────────────

export interface DomainCliArgs {
  vault?: string
  db?: string
  preview?: string
  planOut?: string
  apply: boolean
  plan?: string
  backupDir?: string
  report?: string
  folder?: string
  help: boolean
}

export function parseArgs(argv: readonly string[]): DomainCliArgs {
  const args: DomainCliArgs = { apply: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} 需要一個值`)
      return next
    }
    if (flag === '--vault') args.vault = value()
    else if (flag === '--db') args.db = value()
    else if (flag === '--preview') args.preview = value()
    else if (flag === '--plan-out') args.planOut = value()
    else if (flag === '--apply') args.apply = true
    else if (flag === '--plan') args.plan = value()
    else if (flag === '--backup-dir') args.backupDir = value()
    else if (flag === '--report') args.report = value()
    else if (flag === '--folder') args.folder = value()
    else if (flag === '--help' || flag === '-h') args.help = true
    else throw new Error(`不認得的參數：${flag}`)
  }
  return args
}

const USAGE = `領域資料表遷移成 MOC 檔（ALMNC-69.6）

預覽（只讀，不改任何東西）：
  node scripts/migrate-domains.mjs --vault <筆記庫資料夾> --db <note.db> --preview <預覽.md> [--plan-out <計畫.json>] [--folder <MOC 資料夾>]

套用（先備份筆記庫與 note.db、先關閉 App）：
  node scripts/migrate-domains.mjs --vault <筆記庫資料夾> --db <note.db> --apply --plan <計畫.json> --backup-dir <備份資料夾> [--report <結果.md>]

選項：
  --folder <資料夾>  MOC 檔放的資料夾（筆記庫相對路徑），預設「${DEFAULT_DOMAIN_FOLDER}」。
`

// ── 讀快照 ──────────────────────────────────────────────────

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function num(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
}

export function readDomainDbSnapshot(db: DatabaseSync): Omit<DomainMigrationSnapshot, 'notes'> {
  const domains = tableExists(db, 'domains')
    ? (() => {
      const cols = columnsOf(db, 'domains')
      const parent = cols.has('parent_id') ? 'parent_id' : 'null'
      const overview = cols.has('overview') ? 'overview' : "''"
      return db.prepare(`select id, name, ${parent} as parentId, ${overview} as overview, created_at as createdAt from domains`).all()
        .map(row => ({ id: text(row.id), name: text(row.name), parentId: row.parentId ? text(row.parentId) : null, overview: text(row.overview), createdAt: num(row.createdAt) }))
    })()
    : []
  const idIndex = tableExists(db, 'id_index')
    ? db.prepare('select id, kind, path, name from id_index').all()
      .map(row => ({ id: text(row.id), kind: text(row.kind), path: row.path ? text(row.path) : null, name: row.name ? text(row.name) : null }))
    : []
  return { domains, idIndex }
}

// ── 計畫檔 ──────────────────────────────────────────────────

export interface DomainPlanFile {
  version: 1
  ticket: 'ALMNC-69.6'
  generatedAt: number
  vault: string
  db: string
  plan: DomainMigrationPlan
}

function planPathFor(preview: string): string {
  return preview.replace(/\.md$/i, '') + '.plan.json'
}

// ── 套用 ────────────────────────────────────────────────────

export interface DomainApplyResult {
  written: string[]
  skipped: string[]
  /** 寫成的 MOC 在套用當下重算的歸屬數合計。 */
  membershipsBefore: number
  /** 寫成的 MOC 檔讀回數到的「尚未分章」收錄行數合計。 */
  memberLinesWritten: number
  idIndex: number
}

/** 檔案部分：每個要新建的 MOC 先做版本檢查（重算歸屬要和計畫一樣），再獨佔建立（已存在就不寫），寫完讀回驗證收錄行數。 */
export function applyMocFiles(vault: string, plan: DomainMigrationPlan): DomainApplyResult {
  const result: DomainApplyResult = { written: [], skipped: [], membershipsBefore: 0, memberLinesWritten: 0, idIndex: 0 }
  const current = collectMemberships(readVaultNotes(vault), plan.domains)
  for (const moc of plan.mocs) {
    if (moc.status !== 'create' || !moc.content) continue
    const now = (current.byName.get(moc.name) ?? []).map(member => `${member.notePath}→${member.link}`).sort()
    const planned = moc.members.map(member => `${member.notePath}→${member.link}`).sort()
    if (now.length !== planned.length || now.some((entry, index) => entry !== planned[index])) {
      result.skipped.push(`${moc.path}：預覽之後歸屬變了（預覽 ${planned.length} 則、現在 ${now.length} 則），跳過；重跑預覽會重新計算`)
      continue
    }
    const full = join(vault, ...moc.path.split('/'))
    if (existsSync(full)) {
      result.skipped.push(`${moc.path}：預覽之後已經有這個檔，不覆寫`)
      continue
    }
    mkdirSync(dirname(full), { recursive: true })
    try {
      writeFileSync(full, moc.content, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      result.skipped.push(`${moc.path}：寫不進去（${error instanceof Error ? error.message : String(error)}）`)
      continue
    }
    const lines = countUnchapteredLines(readFileSync(full, 'utf8'))
    result.written.push(moc.path)
    result.membershipsBefore += now.length
    result.memberLinesWritten += lines
    if (lines !== now.length) result.skipped.push(`${moc.path}：寫入後讀回的收錄行 ${lines} 行，和歸屬 ${now.length} 則不同，請檢查這個檔`)
  }
  return result
}

function ensureIdIndex(db: DatabaseSync) {
  // 與 src/db/id-index.ts 同一份結構。
  db.exec(`create table if not exists id_index (
    id text primary key,
    kind text not null,
    path text,
    last_name text,
    name text,
    created_at integer not null,
    updated_at integer not null
  )`)
  db.exec('create index if not exists idx_id_index_path on id_index(path)')
  db.exec('create index if not exists idx_id_index_kind_name on id_index(kind, name)')
}

/** 資料庫部分：id_index 記 M 編號 ↔ MOC 路徑（一個交易）。只登記真的寫成或本來就存在的 MOC；domains 表不動。 */
export function applyIdIndex(db: DatabaseSync, plan: DomainMigrationPlan, result: DomainApplyResult, now = Date.now()): void {
  const ready = new Set(result.written)
  for (const moc of plan.mocs) if (moc.status === 'exists') ready.add(moc.path)
  db.exec('begin immediate')
  try {
    ensureIdIndex(db)
    const insert = db.prepare('insert into id_index (id, kind, path, last_name, name, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict(id) do nothing')
    const byName = db.prepare("select id from id_index where kind = 'M' and name = ? limit 1")
    const update = db.prepare('update id_index set path = ?, last_name = ?, name = coalesce(name, ?), updated_at = ? where id = ? and path is ?')
    for (const change of plan.idIndex) {
      if (!change.path || !ready.has(change.path)) continue
      if (change.action === 'insert') {
        const existing = change.name ? byName.get(change.name) : undefined
        if (existing && text(existing.id) !== change.id) {
          result.skipped.push(`系統索引：領域「${change.name}」已有 M 編號 ${text(existing.id)}，不再登記 ${change.id}（${change.path} 已寫出，請手動對照）`)
          continue
        }
        result.idIndex += Number(insert.run(change.id, 'M', change.path, lastNameOf(change.path), change.name ?? null, change.createdAt, now).changes)
      } else {
        const done = Number(update.run(change.path, lastNameOf(change.path), change.name ?? null, now, change.id, change.previousPath ?? null).changes)
        if (done) result.idIndex++
        else result.skipped.push(`系統索引 ${change.id}：記的路徑已經不是 ${change.previousPath ?? '（空）'}，沒有更新`)
      }
    }
    db.exec('commit')
  } catch (error) {
    db.exec('rollback')
    throw error
  }
}

// ── 主程式 ──────────────────────────────────────────────────

function log(line: string) {
  process.stdout.write(`${line}\n`)
}

async function preview(args: Required<Pick<DomainCliArgs, 'vault' | 'db' | 'preview'>> & DomainCliArgs): Promise<number> {
  const db = await openDatabase(args.db, true)
  let snapshot: DomainMigrationSnapshot
  try {
    snapshot = { ...readDomainDbSnapshot(db), notes: readVaultNotes(args.vault) }
  } finally {
    db.close()
  }
  const generatedAt = Date.now()
  const plan = planDomainMigration(snapshot, { now: generatedAt, ...(args.folder !== undefined ? { folder: args.folder } : {}) })
  const planPath = args.planOut ?? planPathFor(args.preview)
  const file: DomainPlanFile = { version: 1, ticket: 'ALMNC-69.6', generatedAt, vault: args.vault, db: args.db, plan }
  writeAtomic(args.preview, renderDomainMigrationReport(plan, { vault: args.vault, db: args.db, generatedAt }))
  writeAtomic(planPath, JSON.stringify(file))
  const s = plan.stats
  log(`預覽：${args.preview}`)
  log(`計畫：${planPath}`)
  log(`MOC 新建 ${s.mocsToCreate}、已存在 ${s.mocsExisting}、衝突 ${s.mocsConflict}；遷移前歸屬數 ${s.membershipsBefore} = 遷移後收錄行數 ${s.memberLinesWritten}${s.membershipsSkipped ? `＋跳過 ${s.membershipsSkipped}` : ''}；警告 ${plan.warnings.length}、錯誤 ${plan.errors.length}`)
  if (plan.errors.length) {
    log('歸屬數對不上或有其他錯誤，這份計畫不能套用：')
    for (const error of plan.errors) log(`  ${error}`)
    return 1
  }
  return 0
}

async function apply(args: Required<Pick<DomainCliArgs, 'vault' | 'db'>> & DomainCliArgs): Promise<number> {
  if (!args.plan) {
    log('套用要指定 --plan <計畫.json>（預覽時寫出的那一份，套用的就是 Scott 看過的內容）')
    return 2
  }
  const backupError = checkBackup(args.backupDir, args.db)
  if (backupError) {
    log(backupError)
    return 2
  }
  const file = JSON.parse(readFileSync(args.plan, 'utf8')) as DomainPlanFile
  if (file.version !== 1 || file.ticket !== 'ALMNC-69.6' || !file.plan) {
    log('計畫檔格式不對')
    return 2
  }
  if (resolve(file.vault) !== resolve(args.vault) || resolve(file.db) !== resolve(args.db)) {
    log(`計畫檔是對 ${file.vault}／${file.db} 產生的，和這次的 --vault／--db 不同，拒絕套用`)
    return 2
  }
  if (file.plan.errors.length) {
    log('計畫裡有錯誤（歸屬數對不上等），拒絕套用：')
    for (const error of file.plan.errors) log(`  ${error}`)
    return 2
  }
  const bad = file.plan.mocs.find(moc => !isId(moc.mocId, 'M') || moc.path.split('/').some(part => part === '..' || part === ''))
  if (bad) {
    log(`計畫檔裡有不合格的編號或路徑：${bad.mocId} ${bad.path}`)
    return 2
  }
  const result = applyMocFiles(args.vault, file.plan)
  const db = await openDatabase(args.db, false)
  try {
    applyIdIndex(db, file.plan, result)
  } finally {
    db.close()
  }
  const reportPath = args.report ?? args.plan.replace(/\.plan\.json$/i, '').replace(/\.json$/i, '') + '.applied.md'
  writeAtomic(reportPath, renderDomainMigrationReport(file.plan, {
    title: '領域資料表遷移成 MOC 檔套用結果（ALMNC-69.6）',
    vault: args.vault,
    db: args.db,
    generatedAt: Date.now(),
    skipped: result.skipped,
    applied: { membershipsBefore: result.membershipsBefore, memberLinesWritten: result.memberLinesWritten, mocsWritten: result.written.length },
  }).replace('這份預覽沒有改任何檔案或資料庫。', '下列新建的 MOC 檔已寫入（跳過的另列）。'))
  log(`已寫入 MOC ${result.written.length} 個；遷移前歸屬數 ${result.membershipsBefore} = 遷移後收錄行數 ${result.memberLinesWritten}${result.membershipsBefore === result.memberLinesWritten ? '' : '（不相等，請看結果檔）'}；索引 ${result.idIndex}；跳過 ${result.skipped.length}`)
  log(`結果：${reportPath}`)
  return result.membershipsBefore === result.memberLinesWritten ? 0 : 1
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: DomainCliArgs
  try {
    args = parseArgs(argv)
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    log(USAGE)
    return 2
  }
  if (args.help || (!args.preview && !args.apply)) {
    log(USAGE)
    return args.help ? 0 : 2
  }
  if (args.preview && args.apply) {
    log('--preview 和 --apply 一次只能選一個')
    return 2
  }
  if (!args.vault || !existsSync(args.vault) || !statSync(args.vault).isDirectory()) {
    log(`找不到筆記庫資料夾：${args.vault ?? '（沒有指定 --vault）'}`)
    return 2
  }
  if (!args.db || !existsSync(args.db)) {
    log(`找不到 note.db：${args.db ?? '（沒有指定 --db）'}`)
    return 2
  }
  const base = { ...args, vault: resolve(args.vault), db: resolve(args.db) }
  if (args.preview) return preview({ ...base, preview: resolve(args.preview) })
  return apply(base)
}
