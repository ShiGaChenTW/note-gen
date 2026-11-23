import { describe, expect, it } from 'vitest'
import { isId } from '@/lib/v3-model/identity'
import {
  collectMemberships,
  countUnchapteredLines,
  distributeOverview,
  isEmptyDomainPlan,
  mocFileName,
  planDomainMigration,
  renderDomainMigrationReport,
  type DomainMigrationSnapshot,
  type MocFilePlan,
} from './domain-moc-migration'
import { readFrontmatter, type MigrationNoteFile } from './id-migration'

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)
const PARENT_M = 'M-20261104-014500-A57V'

function fixedRandom() {
  let i = 0
  return () => ((i++ * 7) % 36) / 36
}

function note(path: string, frontmatter: string, body = '內文\n'): MigrationNoteFile {
  return { path, raw: frontmatter ? `---\n${frontmatter}\n---\n${body}` : body }
}

const OVERVIEW = [
  '# 時間管理',
  '',
  '怎麼把有限的時間放到最重要的事上。',
  '',
  '## 核心概念',
  '- 注意力比時間更稀缺',
  '',
  '## 重點結論',
  '- 先刪再排。（[[說不比提高效率更省時間]]）',
  '',
  '## 矛盾與未解問題',
  '- 番茄鐘對寫作有沒有效？',
  '',
  '## 參考書目',
  '- 《深度工作》',
].join('\n')

function baseSnapshot(): DomainMigrationSnapshot {
  return {
    notes: [
      note('10 知識筆記/切換工作的代價比想像中高.md', 'id: N-20261103-000000-AAAA\ntype: knowledge\ndomains: [時間管理, 專注力]'),
      note('10 知識筆記/時間區塊要留兩成緩衝.md', 'type: knowledge\ndomains: [dom_time]'),
      note('10 知識筆記/說不比提高效率更省時間.md', 'type: knowledge\ndomains: [專注力, dom_time, 時間管理]'),
      note('30 日誌/週會.md', 'type: log\ndomains: [時間管理]'),
      note('10 知識筆記/孤兒.md', 'type: knowledge\ndomains: [不存在的領域]'),
      note('README.md', ''),
    ],
    domains: [
      { id: 'dom_parent', name: '個人效能', parentId: null, overview: '', createdAt: Date.UTC(2026, 10, 4, 1, 45, 0) },
      { id: 'dom_time', name: '時間管理', parentId: 'dom_parent', overview: OVERVIEW, createdAt: Date.UTC(2026, 10, 12, 6, 0, 12) },
      { id: 'dom_focus', name: '專注力', parentId: 'dom_parent', overview: '', createdAt: Date.UTC(2026, 10, 12, 6, 2, 40) },
    ],
    idIndex: [
      { id: PARENT_M, kind: 'M', path: null, name: '個人效能' },
    ],
  }
}

const plan = (snapshot = baseSnapshot(), folder?: string) => planDomainMigration(snapshot, { now: NOW, random: fixedRandom(), ...(folder ? { folder } : {}) })

function moc(result: ReturnType<typeof plan>, name: string): MocFilePlan {
  const found = result.mocs.find(item => item.name === name)
  if (!found) throw new Error(`沒有 ${name}`)
  return found
}

describe('planDomainMigration', () => {
  it('每個領域一個 MOC 檔：路徑、M 編號（索引已有就沿用）、kind、level', () => {
    const result = plan()
    expect(result.errors).toEqual([])
    expect(result.mocs.map(item => item.path)).toEqual(['20 領域/個人效能.md', '20 領域/時間管理.md', '20 領域/專注力.md'])
    const parent = moc(result, '個人效能')
    expect(parent.mocId).toBe(PARENT_M)
    expect(parent.mocIdSource).toBe('index')
    const fm = readFrontmatter(parent.content!)!
    expect(fm).toMatchObject({ id: PARENT_M, kind: 'domain', level: 1 })
    expect(fm.parent).toBeUndefined()
    const time = moc(result, '時間管理')
    expect(isId(time.mocId, 'M')).toBe(true)
    expect(time.mocId.startsWith('M-20261112-060012-')).toBe(true)
    expect(time.mocIdSource).toBe('new')
  })

  it('parent 由 parent_id 對應成上層的 M 編號，level 2，頁首連到上層；上層列出下層', () => {
    const result = plan()
    const time = moc(result, '時間管理')
    expect(time.level).toBe(2)
    expect(time.parentMocId).toBe(PARENT_M)
    expect(readFrontmatter(time.content!)).toMatchObject({ level: 2, parent: PARENT_M })
    expect(time.content).toContain(`parent: ${PARENT_M}   # 個人效能；存編號，改名不會斷`)
    expect(time.content).toContain('上層：[[個人效能]]')
    expect(moc(result, '個人效能').content).toContain('下層：[[時間管理]]、[[專注力]]')
  })

  it('上層不在領域表：當第一層並警告', () => {
    const snapshot = baseSnapshot()
    snapshot.domains = [{ ...snapshot.domains[2], parentId: 'dom_gone' }]
    const result = plan(snapshot)
    expect(moc(result, '專注力').level).toBe(1)
    expect(result.warnings.some(w => w.includes('dom_gone'))).toBe(true)
  })

  it('舊 overview 搬進五區塊：總覽／核心概念 → ①、重點結論 → ④、矛盾與未解問題 → ⑤、其他放 ① 並註明', () => {
    const content = moc(plan(), '時間管理').content!
    const section = (heading: string) => {
      const start = content.indexOf(heading)
      const next = content.indexOf('\n## ', start + 1)
      return content.slice(start, next < 0 ? undefined : next)
    }
    const position = section('## ① 這個領域在回答什麼')
    expect(position).toContain('怎麼把有限的時間放到最重要的事上。')
    expect(position).toContain('**核心概念**（搬自舊總覽）')
    expect(position).toContain('- 注意力比時間更稀缺')
    expect(position).toContain('**參考書目**（搬自舊總覽，沒有對應的區塊，暫放這裡）')
    expect(position).toContain('- 《深度工作》')
    expect(position).not.toContain('# 時間管理\n\n怎麼')
    expect(section('## ④ 重點結論')).toContain('- 先刪再排。（[[說不比提高效率更省時間]]）')
    expect(section('## ⑤ 待釐清')).toContain('- 番茄鐘對寫作有沒有效？')
    expect(content.indexOf('## ①')).toBeLessThan(content.indexOf('## ②'))
    expect(content.indexOf('## ②')).toBeLessThan(content.indexOf('## ③ 章節'))
    expect(content.indexOf('## ③')).toBeLessThan(content.indexOf('## ④'))
    expect(content.indexOf('## ④')).toBeLessThan(content.indexOf('## ⑤'))
    expect(moc(plan(), '時間管理').overviewMoves.map(move => `${move.from}→${move.to}`)).toEqual([
      '（標題前的文字）→position', '核心概念→position', '重點結論→conclusions', '矛盾與未解問題→open', '參考書目→position',
    ])
  })

  it('舊 overview 是空的：五區塊骨架照樣有，定位問題留註解', () => {
    const content = moc(plan(), '個人效能').content!
    for (const heading of ['## ① 這個領域在回答什麼', '## ② 從這裡開始', '## ③ 章節', '## ④ 重點結論', '## ⑤ 待釐清']) expect(content).toContain(heading)
    expect(content).toContain('<!-- 定位問題還沒寫')
    // 沒有歸屬：不顯示「尚未分章」
    expect(content).not.toContain('### 尚未分章')
  })

  it('舊的歸屬全部放進「尚未分章」：一則一行、帶 C 編號、只收知識筆記、名稱與 dom_ id 都認、同一則只算一次', () => {
    const result = plan()
    const time = moc(result, '時間管理')
    expect(time.members.map(member => member.link)).toEqual(['切換工作的代價比想像中高', '時間區塊要留兩成緩衝', '說不比提高效率更省時間'])
    expect(time.content).toMatch(/### 尚未分章\n<!-- C-20261123-120000-[A-Z0-9]{4} -->\n- \[\[切換工作的代價比想像中高\]\]\n- \[\[時間區塊要留兩成緩衝\]\]\n- \[\[說不比提高效率更省時間\]\]\n/)
    expect(time.content).not.toContain('週會')
    expect(result.warnings.some(w => w.includes('30 日誌/週會.md') && w.includes('不是知識筆記'))).toBe(true)
    expect(result.warnings.some(w => w.includes('不存在的領域'))).toBe(true)
    // 主要領域＝筆記 domains 排第一個
    expect(time.members.filter(member => member.primary).map(member => member.link)).toEqual(['切換工作的代價比想像中高', '時間區塊要留兩成緩衝'])
    expect(moc(result, '專注力').members.filter(member => member.primary).map(member => member.link)).toEqual(['說不比提高效率更省時間'])
  })

  it('筆記 frontmatter 的 domains 不動（計畫裡沒有任何筆記變更）', () => {
    const result = plan()
    expect(Object.keys(result)).not.toContain('notes')
  })

  it('歸屬數相等：遷移前歸屬數 = 遷移後收錄行數', () => {
    const result = plan()
    expect(result.stats.membershipsBefore).toBe(5)
    expect(result.stats.memberLinesWritten).toBe(5)
    expect(result.stats.membershipsSkipped).toBe(0)
    for (const item of result.mocs) expect(countUnchapteredLines(item.content!)).toBe(item.members.length)
    const report = renderDomainMigrationReport(result)
    expect(report).toContain('遷移前歸屬數（知識筆記 domains 對得到領域的組數）：**5**')
    expect(report).toContain('遷移後收錄行數（新 MOC 檔「尚未分章」）：**5**')
    expect(report).toContain('✅ 5 = 5')
  })

  it('收錄行數算錯時寫進 errors（不能套用）', () => {
    const snapshot = baseSnapshot()
    // 檔名含 ]] 的筆記：產生的收錄行不是合格的 `- [[…]]`，數回來會少一行
    snapshot.notes = [...snapshot.notes, note('10 知識筆記/壞]]名.md', 'type: knowledge\ndomains: [專注力]')]
    const result = plan(snapshot)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(renderDomainMigrationReport(result)).toContain('❌ 對不上')
  })

  it('同名檔名的筆記改用路徑連結', () => {
    const snapshot = baseSnapshot()
    snapshot.notes = [...snapshot.notes, note('其他/時間區塊要留兩成緩衝.md', 'type: knowledge\ndomains: [專注力]')]
    const focus = moc(plan(snapshot), '專注力')
    expect(focus.members.map(member => member.link)).toContain('其他/時間區塊要留兩成緩衝')
  })

  it('可重跑：套用後（MOC 檔已在筆記庫、索引已登記）再算是空計畫，不重複', () => {
    const first = plan()
    const snapshot = baseSnapshot()
    snapshot.notes = [...snapshot.notes, ...first.mocs.map(item => ({ path: item.path, raw: item.content! }))]
    snapshot.idIndex = first.mocs.map(item => ({ id: item.mocId, kind: 'M', path: item.path, name: item.name }))
    const second = plan(snapshot)
    expect(second.errors).toEqual([])
    expect(second.mocs.every(item => item.status === 'exists')).toBe(true)
    expect(second.mocs.map(item => item.mocId)).toEqual(first.mocs.map(item => item.mocId))
    expect(isEmptyDomainPlan(second)).toBe(true)
    expect(second.stats.membershipsSkipped).toBe(5)
  })

  it('檔案寫了但索引沒登記（套用中斷）：重跑只補登記索引，不重寫檔', () => {
    const first = plan()
    const snapshot = baseSnapshot()
    snapshot.notes = [...snapshot.notes, ...first.mocs.map(item => ({ path: item.path, raw: item.content! }))]
    const second = plan(snapshot)
    expect(second.mocs.every(item => item.status === 'exists')).toBe(true)
    expect(second.idIndex.map(change => `${change.action}:${change.id}:${change.path}`)).toEqual(first.mocs.map(item =>
      `${item.mocId === PARENT_M ? 'update_path' : 'insert'}:${item.mocId}:${item.path}`))
  })

  it('已存在同名但不是這個領域的檔：衝突，不覆寫、不登記；歸屬數照樣對得上', () => {
    const snapshot = baseSnapshot()
    snapshot.notes = [...snapshot.notes, note('20 領域/專注力.md', 'title: 我自己寫的', '# 專注力\n')]
    const result = plan(snapshot)
    const focus = moc(result, '專注力')
    expect(focus.status).toBe('conflict')
    expect(focus.content).toBeUndefined()
    expect(result.idIndex.some(change => change.name === '專注力')).toBe(false)
    expect(result.warnings.some(w => w.includes('20 領域/專注力.md') && w.includes('不覆寫'))).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.stats.memberLinesWritten + result.stats.membershipsSkipped).toBe(result.stats.membershipsBefore)
    expect(result.stats.membershipsSkipped).toBe(2)
  })

  it('筆記庫已有同名 MOC 檔（frontmatter M 編號，例如範例 vault）：沿用編號、跳過不覆寫、補登記路徑', () => {
    const snapshot = baseSnapshot()
    snapshot.notes = [...snapshot.notes, note('20 領域/時間管理.md', 'id: M-20261112-060012-VPB3\nkind: domain\nlevel: 2')]
    const result = plan(snapshot)
    const time = moc(result, '時間管理')
    expect(time.mocId).toBe('M-20261112-060012-VPB3')
    expect(time.mocIdSource).toBe('vault')
    expect(time.status).toBe('exists')
    expect(result.idIndex).toContainEqual(expect.objectContaining({ action: 'insert', id: 'M-20261112-060012-VPB3', path: '20 領域/時間管理.md' }))
  })

  it('MOC 檔被搬到別的資料夾（同 M 編號）：當已存在，不在預設位置再寫一份', () => {
    const first = plan()
    const time = moc(first, '時間管理')
    const snapshot = baseSnapshot()
    snapshot.idIndex = [...snapshot.idIndex, { id: time.mocId, kind: 'M', path: '20 領域/時間管理.md', name: '時間管理' }]
    snapshot.notes = [...snapshot.notes, { path: '領域/時間管理.md', raw: time.content! }]
    const result = plan(snapshot)
    expect(moc(result, '時間管理')).toMatchObject({ status: 'exists', path: '領域/時間管理.md' })
    expect(result.idIndex).toContainEqual(expect.objectContaining({ action: 'update_path', id: time.mocId, previousPath: '20 領域/時間管理.md', path: '領域/時間管理.md' }))
  })

  it('同名的兩列合成一個 MOC；--folder 可以改資料夾；檔名不能用的字元換掉並寫 title', () => {
    const snapshot = baseSnapshot()
    snapshot.domains = [...snapshot.domains, { id: 'dom_time2', name: '時間管理', parentId: null, overview: '', createdAt: Date.UTC(2026, 10, 20) }, { id: 'dom_io', name: 'I/O 設計', parentId: null, overview: '', createdAt: Date.UTC(2026, 10, 21) }]
    const result = plan(snapshot, '領域')
    expect(result.mocs.map(item => item.path)).toEqual(['領域/個人效能.md', '領域/時間管理.md', '領域/專注力.md', '領域/I-O 設計.md'])
    expect(moc(result, '時間管理').domainIds).toEqual(['dom_time', 'dom_time2'])
    expect(readFrontmatter(moc(result, 'I/O 設計').content!)).toMatchObject({ title: 'I/O 設計' })
    expect(mocFileName('a:b#c')).toBe('a-b-c')
  })

  it('預覽報告列出每個 MOC 的完整內容', () => {
    const result = plan()
    const report = renderDomainMigrationReport(result, { vault: '/v', db: '/d', generatedAt: NOW })
    for (const item of result.mocs) {
      expect(report).toContain(`### ${item.path}`)
      expect(report).toContain(item.content!.trimEnd())
    }
    expect(report).toContain('「重點結論」→ ④ 重點結論')
  })
})

describe('collectMemberships / distributeOverview / countUnchapteredLines', () => {
  it('collectMemberships 數的是（筆記, 領域）組數', () => {
    const snapshot = baseSnapshot()
    const result = collectMemberships(snapshot.notes, snapshot.domains)
    expect(result.total).toBe(5)
    expect(result.byName.get('專注力')?.map(member => member.link)).toEqual(['切換工作的代價比想像中高', '說不比提高效率更省時間'])
  })

  it('distributeOverview：code fence 裡的 ## 不當標題', () => {
    const { blocks } = distributeOverview('## 重點結論\n```\n## 不是標題\n```\n- 結論')
    expect(blocks.conclusions[0]).toContain('## 不是標題')
    expect(blocks.position).toEqual([])
  })

  it('countUnchapteredLines 只數 ③ 章節底下「尚未分章」的收錄行', () => {
    const content = '## ① 這個領域在回答什麼\n### 尚未分章\n- [[x]]\n## ③ 章節\n### 決定做什麼\n- [[a]] ── 說明\n### 尚未分章\n<!-- C-1 -->\n- [[b]]\n- [[c]]\n- 不是收錄\n## ④ 重點結論\n- [[d]]\n'
    expect(countUnchapteredLines(content)).toBe(2)
  })
})
