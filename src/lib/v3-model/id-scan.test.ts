import { describe, expect, it } from 'vitest'
import { CLOCK_TOLERANCE_MS, parseChapters, planScan, scanCandidates, scanNotices, summarizeScan, type ScanFile, type ScanIndexRow, type ScanPlan, type ScanSnapshot } from './id-scan'
import { isId, parseId } from './identity'

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)

/** 每次呼叫回傳下一個值，讓短碼可預期（0 → A）。 */
function counter(): () => number {
  let i = 0
  return () => ((i++ * 7) % 36) / 36
}

const opts = () => ({ now: NOW, random: counter(), timezoneOffsetMinutes: -480 })

function note(id: string | null, body = '內容', extra = ''): string {
  const idLine = id === null ? '' : `id: ${id}\n`
  return `---\n${idLine}type: knowledge\n${extra}---\n# 標題\n\n${body}\n`
}

const MOC_BODY = (c1: string | null, c2: string | null) => [
  '# 時間管理',
  '',
  '## ① 這個領域在回答什麼',
  '問題',
  '',
  '## ③ 章節',
  '',
  '### 決定做什麼',
  ...(c1 ? [`<!-- ${c1} -->`] : []),
  '- [[時間不能管理]] ── 出發點',
  '',
  '### 尚未分章',
  ...(c2 ? [`<!-- ${c2} -->`] : []),
  '- [[切換工作]]',
  '',
  '## ④ 重點結論',
  '### 這不是章節',
  '',
].join('\n')

function moc(id: string | null, c1: string | null, c2: string | null): string {
  return `---\n${id ? `id: ${id}\n` : ''}kind: domain\nlevel: 2\n---\n${MOC_BODY(c1, c2)}`
}

function run(files: ScanFile[], idIndex: ScanIndexRow[] = [], paths?: string[], extra: Partial<Parameters<typeof planScan>[1]> = {}): ScanPlan {
  const snapshot: ScanSnapshot = { files, idIndex, ...(paths ? { paths } : {}) }
  return planScan(snapshot, { ...opts(), ...extra })
}

function apply(files: ScanFile[], plan: ScanPlan): ScanFile[] {
  const byPath = new Map(plan.writes.map(write => [write.path, write.after]))
  return files.map(file => ({ ...file, raw: byPath.get(file.path) ?? file.raw }))
}

function applyIndex(rows: ScanIndexRow[], plan: ScanPlan): ScanIndexRow[] {
  const map = new Map(rows.map(row => [row.id, row]))
  for (const upsert of plan.index) map.set(upsert.id, { id: upsert.id, kind: upsert.kind, path: upsert.path ?? null, name: upsert.name ?? null })
  return [...map.values()]
}

const N1 = 'N-20261110-063015-B3XR'
const N2 = 'N-20261111-010203-QQQQ'
const M1 = 'M-20261112-060012-VPB3'
const C1 = 'C-20261112-060020-N9NR'
const C2 = 'C-20261112-060024-3XSV'

describe('parseChapters', () => {
  it('只取「章節」區的 ### 標題與下一行的 C 註解', () => {
    const chapters = parseChapters(MOC_BODY(C1, null))
    expect(chapters.map(chapter => chapter.heading)).toEqual(['決定做什麼', '尚未分章'])
    expect(chapters[0].id).toBe(C1)
    expect(chapters[1].id).toBeUndefined()
    expect(chapters[1].commentLine).toBeUndefined()
  })
})

describe('例外 1：沒有編號的檔案補號', () => {
  it('V3 筆記補 N（時間用檔案建立時間），一般 Markdown 不動，並登記 id_index', () => {
    const birth = Date.UTC(2026, 10, 20, 3, 4, 5)
    const files: ScanFile[] = [
      { path: '10 知識筆記/新筆記.md', raw: note(null), birthtime: birth, mtime: birth + 60_000 },
      { path: '隨手.md', raw: '# 沒有 frontmatter\n', birthtime: birth },
    ]
    const plan = run(files)
    expect(plan.writes.map(write => write.path)).toEqual(['10 知識筆記/新筆記.md'])
    const assign = plan.actions.find(action => action.type === 'assign')!
    expect(assign).toMatchObject({ type: 'assign', kind: 'N', path: '10 知識筆記/新筆記.md' })
    const id = (assign as { id: string }).id
    expect(isId(id, 'N')).toBe(true)
    expect(parseId(id)!.at.getTime()).toBe(birth)
    expect(plan.writes[0].after.startsWith(`---\nid: ${id}\ntype: knowledge\n`)).toBe(true)
    expect(plan.index).toEqual([{ id, kind: 'N', path: '10 知識筆記/新筆記.md', dependsOn: '10 知識筆記/新筆記.md' }])
  })

  it('新 MOC 補 M（名稱用檔名）與每個章節的 C；套用後重跑沒有任何動作', () => {
    const birth = Date.UTC(2026, 10, 21)
    const files: ScanFile[] = [{ path: '20 領域/時間管理.md', raw: moc(null, null, null), birthtime: birth }]
    const plan = run(files)
    const assigns = plan.actions.filter(action => action.type === 'assign')
    expect(assigns.map(action => (action as { kind: string }).kind)).toEqual(['M', 'C', 'C'])
    const after = plan.writes[0].after
    expect(after).toMatch(/### 決定做什麼\n<!-- C-20261121-000000-[A-Z0-9]{4} -->\n- \[\[時間不能管理\]\]/)
    expect(after).toMatch(/### 尚未分章\n<!-- C-/)
    expect(after).toMatch(/### 這不是章節\n$/)
    expect(plan.index.find(row => row.kind === 'M')).toMatchObject({ name: '時間管理', path: '20 領域/時間管理.md' })
    expect(plan.index.filter(row => row.kind === 'C').map(row => row.name)).toEqual(['決定做什麼', '尚未分章'])

    const again = run(apply(files, plan), applyIndex([], plan))
    expect(again.writes).toEqual([])
    expect(again.index).toEqual([])
    expect(again.actions).toEqual([])
  })

  it('一次要補號超過上限時整批不補，回報 held', () => {
    const files: ScanFile[] = Array.from({ length: 3 }, (_, i) => ({ path: `n${i}.md`, raw: note(null), birthtime: NOW - 1000 }))
    const plan = run(files, [], undefined, { maxAssign: 2 })
    expect(plan.writes).toEqual([])
    expect(plan.index).toEqual([])
    expect(plan.actions).toEqual([{ type: 'held', paths: ['n0.md', 'n1.md', 'n2.md'] }])
  })
})

describe('例外 2：複本重號', () => {
  it('保留 id_index 記的原檔，複本換新編號（時間用複本建立時間）並通知', () => {
    const copyBirth = Date.UTC(2026, 10, 22, 8)
    const files: ScanFile[] = [
      { path: 'a 1.md', raw: note(N1, '複本'), birthtime: Date.UTC(2026, 10, 1) }, // 複本建立時間反而早（同步工具），仍以索引為準
      { path: 'a.md', raw: note(N1, '原檔'), birthtime: copyBirth },
    ]
    const plan = run(files, [{ id: N1, kind: 'N', path: 'a.md' }])
    expect(plan.writes.map(write => write.path)).toEqual(['a 1.md'])
    const renumber = plan.actions.find(action => action.type === 'renumber') as { id: string, oldId: string, keptPath: string, path: string }
    expect(renumber).toMatchObject({ path: 'a 1.md', oldId: N1, keptPath: 'a.md' })
    expect(isId(renumber.id, 'N')).toBe(true)
    expect(parseId(renumber.id)!.at.getTime()).toBe(Date.UTC(2026, 10, 1))
    expect(plan.writes[0].after).toContain(`id: ${renumber.id}`)
    expect(plan.index).toEqual([{ id: renumber.id, kind: 'N', path: 'a 1.md', dependsOn: 'a 1.md' }])
    expect(summarizeScan(plan.actions).renumbered).toEqual([{ path: 'a 1.md', keptPath: 'a.md' }])
  })

  it('索引沒記時，保留建立時間較早的；複製的 MOC 連章節編號一起換', () => {
    const files: ScanFile[] = [
      { path: '20 領域/時間管理 copy.md', raw: moc(M1, C1, C2), birthtime: NOW - 1000 },
      { path: '20 領域/時間管理.md', raw: moc(M1, C1, C2), birthtime: NOW - 10 * 86_400_000 },
    ]
    const plan = run(files)
    expect(plan.writes.map(write => write.path)).toEqual(['20 領域/時間管理 copy.md'])
    const renumbers = plan.actions.filter(action => action.type === 'renumber')
    expect(renumbers.map(action => (action as { oldId: string }).oldId).sort()).toEqual([C1, C2, M1].sort())
    expect(plan.writes[0].after).not.toContain(M1)
    expect(plan.writes[0].after).not.toContain(C1)
  })
})

describe('例外 3：編號被刪時依索引補回', () => {
  it('frontmatter 的 id 被刪：依上次路徑補回原編號並通知', () => {
    const files: ScanFile[] = [{ path: 'a.md', raw: note(null), birthtime: NOW - 1000 }]
    const plan = run(files, [{ id: N1, kind: 'N', path: 'a.md' }])
    expect(plan.actions).toEqual([{ type: 'restore', path: 'a.md', id: N1 }])
    expect(plan.writes[0].after).toContain(`id: ${N1}`)
    expect(summarizeScan(plan.actions).restored).toEqual(['a.md'])
  })

  it('id 改壞也補回；同時被搬家時依檔名找回並改連結', () => {
    const files: ScanFile[] = [
      { path: '新資料夾/a.md', raw: note('亂打', '內容'), birthtime: NOW - 1000 },
      { path: 'b.md', raw: note(N2, '見 [[舊資料夾/a]]') },
    ]
    const index: ScanIndexRow[] = [{ id: N1, kind: 'N', path: '舊資料夾/a.md' }, { id: N2, kind: 'N', path: 'b.md' }]
    const plan = run(files, index)
    expect(plan.actions).toContainEqual({ type: 'restore', path: '新資料夾/a.md', id: N1 })
    expect(plan.actions).toContainEqual({ type: 'rename', id: N1, from: '舊資料夾/a.md', to: '新資料夾/a.md' })
    expect(plan.writes.find(write => write.path === '新資料夾/a.md')!.after).toContain(`id: ${N1}`)
    expect(plan.writes.find(write => write.path === 'b.md')!.after).toContain('[[a]]')
  })

  it('章節的 C 註解被刪：依 MOC 路徑與章節名稱補回；名稱對不上的才補新號', () => {
    const files: ScanFile[] = [{ path: 'moc.md', raw: moc(M1, null, null) }]
    const index: ScanIndexRow[] = [
      { id: M1, kind: 'M', path: 'moc.md', name: '時間管理' },
      { id: C1, kind: 'C', path: 'moc.md', name: '決定做什麼' },
      { id: C2, kind: 'C', path: 'moc.md', name: '已經改名的章節' },
    ]
    const plan = run(files, index)
    expect(plan.actions).toContainEqual({ type: 'restore', path: 'moc.md', id: C1, heading: '決定做什麼' })
    const assign = plan.actions.find(action => action.type === 'assign') as { id: string, heading: string }
    expect(assign.heading).toBe('尚未分章')
    expect(assign.id).not.toBe(C2)
    expect(plan.writes[0].after).toContain(`### 決定做什麼\n<!-- ${C1} -->\n`)
  })
})

describe('例外 4：時鐘異常', () => {
  it('現在時間比既有最大編號早超過 5 分鐘：提醒', () => {
    const future = 'N-20261124-000000-ZZZZ' // 比 NOW 晚 12 小時
    const plan = run([{ path: 'a.md', raw: note(future) }], [{ id: future, kind: 'N', path: 'a.md' }])
    expect(plan.actions).toContainEqual({ type: 'clock', reason: 'behind', id: future })
    expect(plan.actions).toContainEqual({ type: 'clock', reason: 'future', id: future, path: 'a.md' })
    expect(plan.writes).toEqual([])
  })

  it('門檻內（5 分鐘）不提醒', () => {
    const near = new Date(NOW + CLOCK_TOLERANCE_MS - 1000)
    const stamp = near.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const id = `N-${stamp}-AAAA`
    const plan = run([{ path: 'a.md', raw: note(id) }], [{ id, kind: 'N', path: 'a.md' }])
    expect(plan.actions).toEqual([])
  })

  it('檔案建立時間在未來：編號壓回現在並提醒；筆記編號早於資料源也提醒', () => {
    const plan = run([
      { path: 'new.md', raw: note(null), birthtime: NOW + 86_400_000 },
      { path: 'old.md', raw: note(N1, '', 'sources: [S-20261120-000000-AAAA]\n') },
    ], [{ id: N1, kind: 'N', path: 'old.md' }])
    const assign = plan.actions.find(action => action.type === 'assign') as { id: string }
    expect(parseId(assign.id)!.at.getTime()).toBe(NOW)
    expect(plan.actions).toContainEqual({ type: 'clock', reason: 'future', id: assign.id, path: 'new.md' })
    expect(plan.actions).toContainEqual({ type: 'clock', reason: 'before-source', id: N1, path: 'old.md', sourceId: 'S-20261120-000000-AAAA' })
  })
})

describe('例外 5：檔名在 App 外被改', () => {
  it('依編號找到新路徑：更新 id_index，指向舊檔名的連結改到新檔名並通知', () => {
    const files: ScanFile[] = [
      { path: '10/新名字.md', raw: note(N1) },
      { path: '10/引用.md', raw: note(N2, '見 [[舊名字]] 與 [[舊名字#段落|別名]]，還有 [[其他]]') },
      { path: '30/日誌.md', raw: '# 不是 V3\n[[舊名字]]\n' },
    ]
    const paths = ['10/新名字.md', '10/引用.md', '30/日誌.md', '其他.md']
    const index: ScanIndexRow[] = [{ id: N1, kind: 'N', path: '10/舊名字.md' }, { id: N2, kind: 'N', path: '10/引用.md' }]
    const plan = run(files, index, paths)
    expect(plan.actions).toContainEqual({ type: 'rename', id: N1, from: '10/舊名字.md', to: '10/新名字.md' })
    expect(plan.index).toEqual([{ id: N1, kind: 'N', path: '10/新名字.md', afterRelink: true }])
    expect(plan.writes.find(write => write.path === '10/引用.md')!.after).toContain('見 [[新名字]] 與 [[新名字#段落|別名]]，還有 [[其他]]')
    expect(plan.writes.find(write => write.path === '30/日誌.md')!.after).toBe('# 不是 V3\n[[新名字]]\n')
    expect(plan.writes.some(write => write.path === '10/新名字.md')).toBe(false)
    const summary = summarizeScan(plan.actions)
    expect(summary).toMatchObject({ relinkedFiles: 2, relinkedLinks: 3, renamed: [{ from: '10/舊名字.md', to: '10/新名字.md' }] })

    const again = run(apply(files, plan), applyIndex(index, plan), paths)
    expect(again.actions).toEqual([])
    expect(again.writes).toEqual([])
  })

  it('MOC 改名時 id_index 的名稱（domains 對應）不變；舊路徑還有別的檔案時不改連結', () => {
    const files: ScanFile[] = [
      { path: '20/新名.md', raw: moc(M1, C1, C2) },
      { path: 'x.md', raw: note(N2, '[[舊名]]') },
    ]
    const index: ScanIndexRow[] = [
      { id: M1, kind: 'M', path: '20/舊名.md', name: '時間管理' },
      { id: C1, kind: 'C', path: '20/舊名.md', name: '決定做什麼' },
      { id: C2, kind: 'C', path: '20/舊名.md', name: '尚未分章' },
      { id: N2, kind: 'N', path: 'x.md' },
    ]
    const plan = run(files, index, ['20/新名.md', '20/舊名.md', 'x.md'])
    expect(plan.index).toContainEqual({ id: M1, kind: 'M', path: '20/新名.md', name: '時間管理', afterRelink: true })
    expect(plan.index).toContainEqual({ id: C1, kind: 'C', path: '20/新名.md', name: '決定做什麼' })
    expect(plan.writes).toEqual([])
  })
})

describe('scanCandidates', () => {
  it('挑 V3 筆記、MOC、有編號的檔案，以及連到舊檔名的檔案', () => {
    const notes = [
      { path: 'v3.md', frontmatter: { type: 'log' }, links: [] },
      { path: 'moc.md', frontmatter: { kind: 'domain' }, links: [] },
      { path: 'id.md', frontmatter: { id: N1 }, links: [] },
      { path: 'plain.md', frontmatter: null, links: [{ target: '其他' }] },
      { path: 'linker.md', frontmatter: null, links: [{ target: '資料夾/舊名字#段落' }] },
    ]
    expect(scanCandidates(notes, [{ id: N2, kind: 'N', path: '10/舊名字.md' }])).toEqual(['v3.md', 'moc.md', 'id.md', 'linker.md'])
  })
})

describe('scanNotices', () => {
  it('重號、補回、改名、時鐘、大量補號各一則；補新號不通知', () => {
    const notices = scanNotices(summarizeScan([
      { type: 'assign', path: 'n.md', id: N1, kind: 'N' },
      { type: 'renumber', path: '10/a 1.md', oldId: N1, id: N2, keptPath: '10/a.md' },
      { type: 'restore', path: 'b.md', id: N2 },
      { type: 'rename', id: N1, from: '舊.md', to: '10/新.md' },
      { type: 'relink', path: 'c.md', count: 2 },
      { type: 'clock', reason: 'behind', id: N1 },
      { type: 'clock', reason: 'before-source', id: N1, path: 'd.md', sourceId: 'S-20261120-000000-AAAA' },
      { type: 'held', paths: ['x.md', 'y.md'] },
    ]))
    expect(notices.map(notice => notice.key)).toEqual(['renumbered', 'restored', 'renamed', 'clockBehind', 'clockBeforeSource', 'held'])
    expect(notices[0].values).toEqual({ path: 'a 1', kept: 'a' })
    expect(notices[2].values).toEqual({ count: 1, name: '新', files: 1, links: 2 })
    expect(notices.filter(notice => notice.onceKey).length).toBe(3)
  })
})
