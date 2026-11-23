// 端到端：臨時資料夾裡的筆記庫＋SQLite（node:sqlite），跑預覽、拒絕沒有備份的套用、套用（含版本檢查）、重跑、衝突。
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main, parseArgs, type DomainPlanFile } from './domain-moc-migration-cli'
import { countUnchapteredLines } from './domain-moc-migration'
import { readFrontmatter } from './id-migration'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void
    prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>>, run(...params: unknown[]): unknown }
    close(): void
  }
}

const PARENT_M = 'M-20261104-014500-A57V'
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

function backup(): string {
  const path = join(dir, 'backup')
  mkdirSync(path, { recursive: true })
  copyFileSync(dbPath, join(path, 'note.db'))
  return path
}

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  dir = mkdtempSync(join(tmpdir(), 'almanac-migrate-domains-test-'))
  vault = join(dir, 'vault')
  dbPath = join(dir, 'note.db')
  write('知識/切換工作的代價.md', '---\ntype: knowledge\ndomains: [時間管理, 專注力]\n---\n內文\n')
  write('知識/留緩衝.md', '---\ntype: knowledge\ndomains: [dom_time]\n---\n內文\n')
  write('日誌/週會.md', '---\ntype: log\ndomains: [時間管理]\n---\n記錄\n')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    create table domains (id text primary key, name text not null, parent_id text, overview text not null default '', created_at integer not null, updated_at integer not null);
    create table id_index (id text primary key, kind text not null, path text, last_name text, name text, created_at integer not null, updated_at integer not null);
  `)
  const created = Date.UTC(2026, 10, 12, 6, 0, 12)
  const insert = db.prepare('insert into domains (id, name, parent_id, overview, created_at, updated_at) values (?, ?, ?, ?, ?, ?)')
  insert.run('dom_parent', '個人效能', null, '', created, created)
  insert.run('dom_time', '時間管理', 'dom_parent', '## 總覽\n分配時間。\n\n## 重點結論\n- 先刪再排', created, created)
  insert.run('dom_focus', '專注力', 'dom_parent', '', created + 1000, created + 1000)
  db.prepare('insert into id_index values (?, ?, ?, ?, ?, ?, ?)').run(PARENT_M, 'M', null, null, '個人效能', created, created)
  db.close()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const preview = (name = 'preview.md') => main(['--vault', vault, '--db', dbPath, '--preview', join(dir, name)])
const apply = (plan = 'preview.plan.json', backupDir?: string) =>
  main(['--vault', vault, '--db', dbPath, '--apply', '--plan', join(dir, plan), ...(backupDir ? ['--backup-dir', backupDir] : [])])

describe('domain-moc-migration CLI', () => {
  it('預覽只讀：寫出報告（含每個 MOC 的完整內容、歸屬數）與計畫檔，筆記庫與資料庫都不變', async () => {
    expect(await preview()).toBe(0)
    expect(existsSync(join(vault, '20 領域'))).toBe(false)
    expect(query('select id from id_index')).toEqual([{ id: PARENT_M }])
    const report = readFileSync(join(dir, 'preview.md'), 'utf8')
    expect(report).toContain('✅ 3 = 3')
    expect(report).toContain('### 20 領域/時間管理.md')
    expect(report).toContain('- [[切換工作的代價]]')
    const file = JSON.parse(readFileSync(join(dir, 'preview.plan.json'), 'utf8')) as DomainPlanFile
    expect(file.plan.mocs.map(moc => moc.status)).toEqual(['create', 'create', 'create'])
  })

  it('套用沒有備份就拒絕', async () => {
    await preview()
    expect(await apply()).toBe(2)
    mkdirSync(join(dir, 'empty'))
    expect(await apply('preview.plan.json', join(dir, 'empty'))).toBe(2)
    expect(existsSync(join(vault, '20 領域'))).toBe(false)
  })

  it('套用：寫出 MOC 檔、登記 id_index、domains 表不動；歸屬變了的跳過；重跑不重複', async () => {
    await preview()
    // 預覽之後 Scott 把一則筆記加進專注力：專注力的歸屬和預覽不同，要跳過。
    write('知識/留緩衝.md', '---\ntype: knowledge\ndomains: [dom_time, 專注力]\n---\n內文\n')
    expect(await apply('preview.plan.json', backup())).toBe(0)

    const time = readFileSync(join(vault, '20 領域/時間管理.md'), 'utf8')
    expect(readFrontmatter(time)).toMatchObject({ kind: 'domain', level: 2, parent: PARENT_M })
    expect(countUnchapteredLines(time)).toBe(2)
    expect(time).toContain('- 先刪再排')
    expect(existsSync(join(vault, '20 領域/個人效能.md'))).toBe(true)
    expect(existsSync(join(vault, '20 領域/專注力.md'))).toBe(false)
    expect(query('select count(*) as n from domains')[0].n).toBe(3)
    const index = query("select id, path, name from id_index where kind = 'M' order by name")
    expect(index).toEqual(expect.arrayContaining([
      { id: PARENT_M, path: '20 領域/個人效能.md', name: '個人效能' },
      expect.objectContaining({ path: '20 領域/時間管理.md', name: '時間管理' }),
    ]))
    expect(index).toHaveLength(2)
    const applied = readFileSync(join(dir, 'preview.applied.md'), 'utf8')
    expect(applied).toContain('20 領域/專注力.md：預覽之後歸屬變了')
    expect(applied).toContain('遷移前歸屬數 2、寫入的 2 個 MOC 檔收錄行數 2（相等）')

    // 重跑：只剩專注力要建，已寫的兩個跳過不重寫。
    const before = readFileSync(join(vault, '20 領域/時間管理.md'), 'utf8')
    expect(await preview('again.md')).toBe(0)
    const again = JSON.parse(readFileSync(join(dir, 'again.plan.json'), 'utf8')) as DomainPlanFile
    expect(again.plan.mocs.filter(moc => moc.status === 'create').map(moc => moc.path)).toEqual(['20 領域/專注力.md'])
    expect(again.plan.mocs.filter(moc => moc.status === 'exists')).toHaveLength(2)
    expect(again.plan.errors).toEqual([])
    expect(await apply('again.plan.json', backup())).toBe(0)
    expect(readFileSync(join(vault, '20 領域/時間管理.md'), 'utf8')).toBe(before)
    expect(countUnchapteredLines(readFileSync(join(vault, '20 領域/專注力.md'), 'utf8'))).toBe(2)

    expect(await preview('third.md')).toBe(0)
    expect(readFileSync(join(dir, 'third.md'), 'utf8')).toContain('沒有需要遷移的項目')
  })

  it('已有同名的非 MOC 檔：衝突跳過，不覆寫', async () => {
    write('20 領域/專注力.md', '# 我自己的頁\n')
    expect(await preview()).toBe(0)
    expect(await apply('preview.plan.json', backup())).toBe(0)
    expect(readFileSync(join(vault, '20 領域/專注力.md'), 'utf8')).toBe('# 我自己的頁\n')
    expect(readFileSync(join(dir, 'preview.applied.md'), 'utf8')).toContain('衝突（跳過，不覆寫）')
  })

  it('預覽之後才出現同名檔：套用時不覆寫', async () => {
    await preview()
    write('20 領域/個人效能.md', '# 搶先\n')
    expect(await apply('preview.plan.json', backup())).toBe(0)
    expect(readFileSync(join(vault, '20 領域/個人效能.md'), 'utf8')).toBe('# 搶先\n')
    expect(query(`select path from id_index where id = '${PARENT_M}'`)[0].path).toBeNull()
  })

  it('計畫有錯誤（歸屬數對不上）時拒絕套用', async () => {
    await preview()
    const path = join(dir, 'preview.plan.json')
    const file = JSON.parse(readFileSync(path, 'utf8')) as DomainPlanFile
    file.plan.errors = ['遷移前歸屬數 3 ≠ 遷移後收錄行數 2']
    writeFileSync(path, JSON.stringify(file))
    expect(await apply('preview.plan.json', backup())).toBe(2)
    expect(existsSync(join(vault, '20 領域'))).toBe(false)
  })

  it('參數：--folder', () => {
    expect(parseArgs(['--vault', 'v', '--db', 'd', '--preview', 'p.md', '--folder', '領域'])).toMatchObject({ vault: 'v', db: 'd', preview: 'p.md', folder: '領域', apply: false })
    expect(() => parseArgs(['--bogus'])).toThrow()
  })
})
