// Fork（almanac ALMNC-69.4）：身分編號遷移的終端機入口（App 外執行，直接讀筆記庫資料夾與 note.db）。
// 由 scripts/migrate-ids.mjs 用 esbuild 打包後執行；App 不會 import 這個檔（用到 node:fs、node:sqlite）。
//
//   預覽（只讀）：node scripts/migrate-ids.mjs --vault <筆記庫> --db <note.db> --preview <預覽.md>
//               另外寫出 <預覽>.plan.json（套用時用的計畫，含每一項的 before）。
//   套用：      node scripts/migrate-ids.mjs --vault <筆記庫> --db <note.db> --apply --plan <預覽>.plan.json --backup-dir <備份資料夾>
//               --backup-dir 必須已存在且含 note.db 備份，否則拒絕。先改資料庫（一個交易，失敗整批還原），再寫檔案；
//               每一項都用計畫裡的 before 做版本檢查，被改過的跳過並列在套用報告裡。套用前請先關閉 App。
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { isId } from '@/lib/v3-model/identity'
import { lastNameOf } from '@/lib/v3-model/id-index'
import {
  planIdMigration,
  renderIdMigrationReport,
  type IdMigrationPlan,
  type IdMigrationSnapshot,
  type MigrationNoteFile,
} from './id-migration'

// ── node:sqlite 的最小型別（@types/node 20 還沒有這個模組）──

export interface StatementSync {
  all(...params: unknown[]): Array<Record<string, unknown>>
  get(...params: unknown[]): Record<string, unknown> | undefined
  run(...params: unknown[]): { changes: number | bigint }
}

export interface DatabaseSync {
  prepare(sql: string): StatementSync
  exec(sql: string): void
  close(): void
}

type DatabaseSyncConstructor = new (path: string, options?: { readOnly?: boolean }) => DatabaseSync

export async function openDatabase(path: string, readOnly: boolean): Promise<DatabaseSync> {
  const specifier = 'node:sqlite'
  const sqlite = await import(/* webpackIgnore: true */ specifier) as { DatabaseSync: DatabaseSyncConstructor }
  return new sqlite.DatabaseSync(path, { readOnly })
}

// ── 參數 ────────────────────────────────────────────────────

export interface CliArgs {
  vault?: string
  db?: string
  preview?: string
  planOut?: string
  apply: boolean
  plan?: string
  backupDir?: string
  report?: string
  tzOffset?: number
  help: boolean
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { apply: false, help: false }
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
    else if (flag === '--tz-offset') args.tzOffset = Number(value())
    else if (flag === '--help' || flag === '-h') args.help = true
    else throw new Error(`不認得的參數：${flag}`)
  }
  return args
}

const USAGE = `身分編號遷移（ALMNC-69.4）

預覽（只讀，不改任何東西）：
  node scripts/migrate-ids.mjs --vault <筆記庫資料夾> --db <note.db> --preview <預覽.md> [--plan-out <計畫.json>]

套用（先備份筆記庫與 note.db、先關閉 App）：
  node scripts/migrate-ids.mjs --vault <筆記庫資料夾> --db <note.db> --apply --plan <計畫.json> --backup-dir <備份資料夾> [--report <結果.md>]

選項：
  --tz-offset <分鐘>  檔名時間前綴的本機時區（同 Date#getTimezoneOffset，台灣 -480）；預設用這台電腦的時區。
`

// ── 讀快照 ──────────────────────────────────────────────────

export function tableExists(db: DatabaseSync, name: string): boolean {
  return !!db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(name)
}

export function columnsOf(db: DatabaseSync, table: string): Set<string> {
  return new Set(db.prepare(`pragma table_info(${table})`).all().map(row => String(row.name)))
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function num(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
}

const SKIP_DIRS = new Set(['node_modules'])

/** 筆記庫裡所有 .md（略過 . 開頭的資料夾與檔案，例如 .obsidian、.trash）。 */
export function readVaultNotes(vault: string): MigrationNoteFile[] {
  const out: MigrationNoteFile[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full)
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const stat = statSync(full)
        out.push({
          path: relative(vault, full).split(sep).join('/'),
          raw: readFileSync(full, 'utf8'),
          ...(stat.birthtimeMs > 0 ? { birthtime: Math.round(stat.birthtimeMs) } : {}),
          ...(stat.mtimeMs > 0 ? { mtime: Math.round(stat.mtimeMs) } : {}),
        })
      }
    }
  }
  walk(vault)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function readDbSnapshot(db: DatabaseSync): Omit<IdMigrationSnapshot, 'notes'> {
  const sources = tableExists(db, 'sources')
    ? (() => {
      const legacy = columnsOf(db, 'sources').has('legacy_id')
      return db.prepare(`select id, created_at as createdAt, previous_id as previousId${legacy ? ', legacy_id as legacyId' : ''} from sources`).all()
        .map(row => ({ id: text(row.id), createdAt: num(row.createdAt), previousId: row.previousId ? text(row.previousId) : null, legacyId: row.legacyId ? text(row.legacyId) : null }))
    })()
    : []
  const sourceOutputs = tableExists(db, 'source_outputs')
    ? db.prepare('select source_id as sourceId, target_type as targetType, target_ref as targetRef, created_at as createdAt from source_outputs').all()
      .map(row => ({ sourceId: text(row.sourceId), targetType: text(row.targetType), targetRef: text(row.targetRef), createdAt: num(row.createdAt) }))
    : []
  const domains = tableExists(db, 'domains')
    ? db.prepare('select id, name, created_at as createdAt from domains').all()
      .map(row => ({ id: text(row.id), name: text(row.name), createdAt: num(row.createdAt) }))
    : []
  const idIndex = tableExists(db, 'id_index')
    ? db.prepare('select id, kind, path, name from id_index').all()
      .map(row => ({ id: text(row.id), kind: text(row.kind), path: row.path ? text(row.path) : null, name: row.name ? text(row.name) : null }))
    : []
  const judgementSourceIds = tableExists(db, 'source_judgements') ? db.prepare('select source_id as id from source_judgements').all().map(row => text(row.id)) : []
  const legacyPackSourceIds = tableExists(db, 'legacy_undecided') ? db.prepare('select source_id as id from legacy_undecided').all().map(row => text(row.id)) : []
  return { sources, sourceOutputs, domains, idIndex, judgementSourceIds, legacyPackSourceIds }
}

// ── 計畫檔 ──────────────────────────────────────────────────

export interface PlanFile {
  version: 1
  ticket: 'ALMNC-69.4'
  generatedAt: number
  vault: string
  db: string
  plan: IdMigrationPlan
}

function planPathFor(preview: string): string {
  return preview.replace(/\.md$/i, '') + '.plan.json'
}

export function writeAtomic(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.migrate-ids-${process.pid}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

// ── 套用 ────────────────────────────────────────────────────

/** 套用前的備份檢查：資料夾存在、裡面有 note.db（非空），而且不是要改的那一個檔。 */
export function checkBackup(backupDir: string | undefined, dbPath: string): string | null {
  if (!backupDir) return '套用前必須先備份：請用 --backup-dir 指定備份資料夾（裡面要有 note.db）'
  if (!existsSync(backupDir) || !statSync(backupDir).isDirectory()) return `備份資料夾不存在：${backupDir}`
  const backupDb = join(backupDir, 'note.db')
  if (!existsSync(backupDb) || !statSync(backupDb).isFile() || statSync(backupDb).size === 0) return `備份資料夾裡沒有 note.db：${backupDb}`
  if (realpathSync(backupDb) === realpathSync(dbPath)) return '備份的 note.db 就是要遷移的那一個檔，請先複製到別的資料夾'
  return null
}

export interface ApplyResult {
  applied: { notes: number, sources: number, previousIds: number, outputs: number, sourceRefs: number, idIndex: number }
  skipped: string[]
}

function changes(result: { changes: number | bigint }): number {
  return Number(result.changes)
}

function ensureSchema(db: DatabaseSync) {
  if (tableExists(db, 'sources') && !columnsOf(db, 'sources').has('legacy_id')) db.exec('alter table sources add column legacy_id text')
  if (tableExists(db, 'sources')) db.exec('create unique index if not exists idx_sources_legacy on sources(legacy_id) where legacy_id is not null')
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

/** 資料庫部分：一個交易；任何一步丟錯就整批還原。回傳沒套成的資料源新編號（依賴它們的檔案也不寫）。 */
export function applyDbChanges(db: DatabaseSync, plan: IdMigrationPlan, now = Date.now()): { result: ApplyResult, failedSourceIds: Set<string> } {
  const result: ApplyResult = { applied: { notes: 0, sources: 0, previousIds: 0, outputs: 0, sourceRefs: 0, idIndex: 0 }, skipped: [] }
  const failed = new Set<string>()
  db.exec('begin immediate')
  try {
    ensureSchema(db)
    const renameSource = db.prepare('update sources set id = ?, legacy_id = ? where id = ? and legacy_id is ?')
    for (const change of plan.sources) {
      if (changes(renameSource.run(change.after.id, change.after.legacyId, change.before.id, change.before.legacyId)) === 1) result.applied.sources++
      else {
        failed.add(change.after.id)
        result.skipped.push(`資料源 ${change.before.id}：資料庫裡的列已經不同（被刪除或改過），沒有換成 ${change.after.id}`)
      }
    }
    const setPrevious = db.prepare('update sources set previous_id = ? where previous_id = ?')
    for (const change of plan.previousIds) {
      if (failed.has(change.after)) continue
      result.applied.previousIds += changes(setPrevious.run(change.after, change.before))
    }
    const updateOutput = db.prepare('update or ignore source_outputs set source_id = ?, target_ref = ? where source_id = ? and target_type = ? and target_ref = ?')
    const deleteOutput = db.prepare('delete from source_outputs where source_id = ? and target_type = ? and target_ref = ?')
    for (const change of plan.outputs) {
      const { before, after } = change
      const label = `連結 ${before.sourceId} → ${before.targetType}:${before.targetRef}`
      if (failed.has(after.sourceId)) {
        result.skipped.push(`${label}：資料源沒有換成功，連結不動`)
        continue
      }
      if (change.action === 'update' && changes(updateOutput.run(after.sourceId, after.targetRef, before.sourceId, before.targetType, before.targetRef)) === 1) {
        result.applied.outputs++
        continue
      }
      // 刪除重複，或改寫時新的那一列已經存在（update or ignore 沒改到）：刪掉舊列。
      if (changes(deleteOutput.run(before.sourceId, before.targetType, before.targetRef)) === 1) result.applied.outputs++
      else result.skipped.push(`${label}：資料庫裡已經沒有這一列`)
    }
    for (const change of plan.sourceRefs) {
      if (failed.has(change.after) || !tableExists(db, change.table)) continue
      result.applied.sourceRefs += changes(db.prepare(`update or ignore ${change.table} set source_id = ? where source_id = ?`).run(change.after, change.before))
    }
    const insertIndex = db.prepare('insert into id_index (id, kind, path, last_name, name, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict(id) do nothing')
    const mocByName = db.prepare("select id from id_index where kind = 'M' and name = ? limit 1")
    const updatePath = db.prepare('update id_index set path = ?, last_name = ?, updated_at = ? where id = ? and path is ?')
    for (const change of plan.idIndex) {
      if (change.action === 'insert') {
        if (change.kind === 'M' && change.name) {
          const existing = mocByName.get(change.name)
          if (existing && text(existing.id) !== change.id) {
            result.skipped.push(`領域「${change.name}」：系統索引已有 M 編號 ${text(existing.id)}，不再登記 ${change.id}`)
            continue
          }
        }
        result.applied.idIndex += changes(insertIndex.run(change.id, change.kind, change.path ?? null, change.path ? lastNameOf(change.path) : null, change.name ?? null, change.createdAt, now))
      } else {
        const done = changes(updatePath.run(change.path ?? null, change.path ? lastNameOf(change.path) : null, now, change.id, change.previousPath ?? null))
        if (done) result.applied.idIndex++
        else result.skipped.push(`系統索引 ${change.id}：記的路徑已經不是 ${change.previousPath ?? '（空）'}，沒有更新`)
      }
    }
    db.exec('commit')
  } catch (error) {
    db.exec('rollback')
    throw error
  }
  return { result, failedSourceIds: failed }
}

/** 檔案部分：檔案現在的內容要和計畫的 before 一樣才寫；被改過、讀不到、或依賴沒換成功的資料源都跳過。 */
export function applyFileChanges(vault: string, plan: IdMigrationPlan, failedSourceIds: ReadonlySet<string>, result: ApplyResult): void {
  for (const note of plan.notes) {
    const full = join(vault, ...note.path.split('/'))
    const blocked = note.afterSummary.sources.find(id => failedSourceIds.has(id))
    if (blocked) {
      result.skipped.push(`${note.path}：來源 ${blocked} 沒有換成功，檔案不動`)
      continue
    }
    let current: string
    try {
      current = readFileSync(full, 'utf8')
    } catch {
      result.skipped.push(`${note.path}：讀不到檔案（可能已刪除或搬走）`)
      continue
    }
    if (current !== note.before) {
      result.skipped.push(`${note.path}：預覽之後被改過，跳過（重跑預覽會重新計算）`)
      continue
    }
    writeAtomic(full, note.after)
    result.applied.notes++
  }
}

// ── 主程式 ──────────────────────────────────────────────────

function log(line: string) {
  process.stdout.write(`${line}\n`)
}

async function preview(args: Required<Pick<CliArgs, 'vault' | 'db' | 'preview'>> & CliArgs): Promise<number> {
  const db = await openDatabase(args.db, true)
  let snapshot: IdMigrationSnapshot
  try {
    snapshot = { ...readDbSnapshot(db), notes: readVaultNotes(args.vault) }
  } finally {
    db.close()
  }
  const generatedAt = Date.now()
  const plan = planIdMigration(snapshot, { now: generatedAt, ...(args.tzOffset !== undefined ? { timezoneOffsetMinutes: args.tzOffset } : {}) })
  const planPath = args.planOut ?? planPathFor(args.preview)
  const file: PlanFile = { version: 1, ticket: 'ALMNC-69.4', generatedAt, vault: args.vault, db: args.db, plan }
  writeAtomic(args.preview, renderIdMigrationReport(plan, { vault: args.vault, db: args.db, generatedAt }))
  writeAtomic(planPath, JSON.stringify(file))
  log(`預覽：${args.preview}`)
  log(`計畫：${planPath}`)
  log(`要改的筆記 ${plan.stats.notesChanged}、資料源換 S ${plan.stats.sourcesRenamed}、連結改寫 ${plan.outputs.length}、領域 M 編號 ${plan.stats.domainsWithNewMoc}、警告 ${plan.warnings.length}`)
  return 0
}

async function apply(args: Required<Pick<CliArgs, 'vault' | 'db'>> & CliArgs): Promise<number> {
  if (!args.plan) {
    log('套用要指定 --plan <計畫.json>（預覽時寫出的那一份，套用的就是 Scott 看過的內容）')
    return 2
  }
  const backupError = checkBackup(args.backupDir, args.db)
  if (backupError) {
    log(backupError)
    return 2
  }
  const file = JSON.parse(readFileSync(args.plan, 'utf8')) as PlanFile
  if (file.version !== 1 || file.ticket !== 'ALMNC-69.4' || !file.plan) {
    log('計畫檔格式不對')
    return 2
  }
  if (resolve(file.vault) !== resolve(args.vault) || resolve(file.db) !== resolve(args.db)) {
    log(`計畫檔是對 ${file.vault}／${file.db} 產生的，和這次的 --vault／--db 不同，拒絕套用`)
    return 2
  }
  const bad = file.plan.sources.find(change => !isId(change.after.id, 'S'))
  if (bad) {
    log(`計畫檔裡有不合格的編號：${bad.after.id}`)
    return 2
  }
  const db = await openDatabase(args.db, false)
  let outcome: ReturnType<typeof applyDbChanges>
  try {
    outcome = applyDbChanges(db, file.plan)
  } finally {
    db.close()
  }
  applyFileChanges(args.vault, file.plan, outcome.failedSourceIds, outcome.result)
  const reportPath = args.report ?? args.plan.replace(/\.plan\.json$/i, '').replace(/\.json$/i, '') + '.applied.md'
  writeAtomic(reportPath, renderIdMigrationReport(file.plan, {
    title: '身分編號遷移套用結果（ALMNC-69.4）',
    vault: args.vault,
    db: args.db,
    generatedAt: Date.now(),
    skipped: outcome.result.skipped,
  }).replace('這份預覽沒有改任何檔案或資料庫。', '下列項目已套用（跳過的另列）。'))
  const a = outcome.result.applied
  log(`已套用：筆記 ${a.notes}、資料源 ${a.sources}、版本鏈 ${a.previousIds}、連結 ${a.outputs}、其他表 ${a.sourceRefs}、索引 ${a.idIndex}；跳過 ${outcome.result.skipped.length}`)
  log(`結果：${reportPath}`)
  return 0
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs
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
