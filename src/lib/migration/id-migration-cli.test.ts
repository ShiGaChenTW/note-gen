// 端到端：臨時資料夾裡的筆記庫＋SQLite（node:sqlite），跑預覽、拒絕沒有備份的套用、套用、版本檢查、重跑。
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkBackup, main, parseArgs, type PlanFile } from './id-migration-cli'
import { readFrontmatter } from './id-migration'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void
    prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>>, run(...params: unknown[]): unknown }
    close(): void
  }
}

let dir: string
let vault: string
let dbPath: string

function write(path: string, content: string) {
  const full = join(vault, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

function query(sql: string) {
  const db = new DatabaseSync(dbPath)
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  dir = mkdtempSync(join(tmpdir(), 'almanac-migrate-ids-test-'))
  vault = join(dir, 'vault')
  dbPath = join(dir, 'note.db')
  write('知識/2026-11-20 1430 切換.md', '---\ntype: knowledge\nsources: [src_aaa]\ndomains: [dom_time]\nstatus: 有效\n---\n內文\n')
  write('日誌/週會.md', '---\ntype: record\n---\n記錄\n')
  write('.obsidian/隱藏.md', '---\ntype: knowledge\n---\n')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    create table sources (id text primary key, source_type text not null, kind text not null, content text not null, origin text,
      collected_at integer not null, collector text not null, status text not null, status_changed_at integer not null,
      version integer not null default 1, previous_id text, locked_at integer, archived_at integer, created_at integer not null,
      updated_at integer not null, is_journal integer not null default 0);
    create table source_outputs (source_id text not null, target_type text not null, target_ref text not null, created_at integer not null,
      primary key (source_id, target_type, target_ref));
    create table domains (id text primary key, name text not null, parent_id text, overview text not null default '', created_at integer not null, updated_at integer not null);
    create table source_judgements (source_id text primary key, status text not null, created_at integer not null, updated_at integer not null);
  `)
  const created = Date.UTC(2026, 10, 1, 2, 3, 4)
  db.prepare(`insert into sources (id, source_type, kind, content, collected_at, collector, status, status_changed_at, created_at, updated_at)
    values (?, 'external', 'text', 'x', ?, 'scott', 'analyzed', ?, ?, ?)`).run('src_aaa', created, created, created, created)
  db.prepare(`insert into sources (id, source_type, kind, content, collected_at, collector, status, status_changed_at, created_at, updated_at)
    values (?, 'external', 'email', 'x', ?, 'scott', 'awaiting_decision', ?, ?, ?)`).run('src_email:<m@x>', created, created, created, created)
  db.prepare('insert into source_outputs values (?, ?, ?, ?)').run('src_aaa', 'note', '知識/2026-11-20 1430 切換.md', created)
  db.prepare('insert into domains (id, name, created_at, updated_at) values (?, ?, ?, ?)').run('dom_time', '時間管理', created, created)
  db.prepare('insert into source_judgements values (?, ?, ?, ?)').run('src_email:<m@x>', 'ready', created, created)
  db.close()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const preview = (name = 'preview.md') => main(['--vault', vault, '--db', dbPath, '--preview', join(dir, name), '--tz-offset', '-480'])

describe('id-migration CLI', () => {
  it('預覽只讀：寫出報告與計畫檔，筆記庫與資料庫都不變', async () => {
    const before = readFileSync(join(vault, '知識/2026-11-20 1430 切換.md'), 'utf8')
    expect(await preview()).toBe(0)
    expect(readFileSync(join(vault, '知識/2026-11-20 1430 切換.md'), 'utf8')).toBe(before)
    expect(query('select id from sources order by id').map(row => row.id)).toEqual(['src_aaa', 'src_email:<m@x>'])
    const report = readFileSync(join(dir, 'preview.md'), 'utf8')
    expect(report).toContain('| 要改的筆記檔 | 2 |')
    expect(report).not.toContain('隱藏.md')
    const file = JSON.parse(readFileSync(join(dir, 'preview.plan.json'), 'utf8')) as PlanFile
    expect(file.plan.sources).toHaveLength(2)
  })

  it('套用沒有備份就拒絕', async () => {
    await preview()
    const plan = join(dir, 'preview.plan.json')
    expect(await main(['--vault', vault, '--db', dbPath, '--apply', '--plan', plan])).toBe(2)
    expect(await main(['--vault', vault, '--db', dbPath, '--apply', '--plan', plan, '--backup-dir', join(dir, 'nope')])).toBe(2)
    mkdirSync(join(dir, 'empty'))
    expect(await main(['--vault', vault, '--db', dbPath, '--apply', '--plan', plan, '--backup-dir', join(dir, 'empty')])).toBe(2)
    expect(query('select id from sources order by id').map(row => row.id)).toEqual(['src_aaa', 'src_email:<m@x>'])
  })

  it('套用：資料庫與檔案都改好，被改過的檔案跳過；重跑預覽沒有變更', async () => {
    await preview()
    const backup = join(dir, 'backup')
    mkdirSync(backup)
    copyFileSync(dbPath, join(backup, 'note.db'))
    // 預覽之後 Scott 又改了日誌檔：版本檢查要擋下來。
    write('日誌/週會.md', '---\ntype: record\n---\n記錄（改過）\n')
    expect(await main(['--vault', vault, '--db', dbPath, '--apply', '--plan', join(dir, 'preview.plan.json'), '--backup-dir', backup])).toBe(0)

    const sources = query('select id, legacy_id as legacyId from sources order by legacy_id')
    expect(sources.map(row => row.legacyId)).toEqual(['src_aaa', 'src_email:<m@x>'])
    for (const row of sources) expect(String(row.id)).toMatch(/^S-20261101-020304-[A-Z0-9]{4}$/)
    const aaa = String(sources[0].id)
    const knowledge = readFrontmatter(readFileSync(join(vault, '知識/2026-11-20 1430 切換.md'), 'utf8'))!
    expect(knowledge.id).toMatch(/^N-20261120-063000-/)
    expect(knowledge.sources).toEqual([aaa])
    expect(knowledge.domains).toEqual(['時間管理'])
    expect(knowledge.status).toBe('valid')
    expect(query('select source_id as s, target_ref as t from source_outputs')).toEqual([{ s: aaa, t: knowledge.id }])
    expect(query('select source_id as s from source_judgements')[0].s).toBe(sources[1].id)
    expect(query("select kind, name from id_index where kind = 'M'")).toEqual([{ kind: 'M', name: '時間管理' }])
    expect(readFileSync(join(vault, '日誌/週會.md'), 'utf8')).toContain('記錄（改過）')
    expect(readFileSync(join(dir, 'preview.applied.md'), 'utf8')).toContain('日誌/週會.md：預覽之後被改過')

    // 重跑：只剩被跳過的那個檔案（record → log、補編號）。
    expect(await preview('again.md')).toBe(0)
    const again = JSON.parse(readFileSync(join(dir, 'again.plan.json'), 'utf8')) as PlanFile
    expect(again.plan.sources).toEqual([])
    expect(again.plan.outputs).toEqual([])
    expect(again.plan.domainMocs).toEqual([])
    expect(again.plan.notes.map(note => note.path)).toEqual(['日誌/週會.md'])
  })

  it('計畫檔的筆記庫或資料庫和參數不同時拒絕', async () => {
    await preview()
    const backup = join(dir, 'backup')
    mkdirSync(backup)
    copyFileSync(dbPath, join(backup, 'note.db'))
    const other = join(dir, 'other')
    mkdirSync(other)
    expect(await main(['--vault', other, '--db', dbPath, '--apply', '--plan', join(dir, 'preview.plan.json'), '--backup-dir', backup])).toBe(2)
  })

  it('參數與備份檢查', () => {
    expect(parseArgs(['--vault', 'v', '--db', 'd', '--preview', 'p.md'])).toMatchObject({ vault: 'v', db: 'd', preview: 'p.md', apply: false })
    expect(() => parseArgs(['--vault'])).toThrow()
    expect(checkBackup(undefined, dbPath)).toContain('--backup-dir')
    expect(checkBackup(dir, dbPath)).toContain('就是要遷移的那一個檔')
  })
})
