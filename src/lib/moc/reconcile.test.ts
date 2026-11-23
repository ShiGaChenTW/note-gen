import { describe, expect, it } from 'vitest'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import { membershipsFromMocs } from './membership'
import { formalEntries, parseMoc } from './parse'
import { batchCheck, diffToOpSpec, isBulkImport, isEffectiveDiff, reconcileMoc, revertDiffs, type ReconcileDiff } from './reconcile'

const MOC_PATH = '20 領域/時間管理.md'
const C_WHAT = 'C-20261112-060020-N9NR'
const C_WHEN = 'C-20261112-060024-3XSV'
const C_UNSORTED = 'C-20261112-060030-UNSO'

const NOTES = ['筆記A', '筆記B', '筆記C', '筆記D', '筆記E', '筆記F', '筆記G'].map(name => `10 知識/${name}.md`)
const PATHS = [...NOTES, MOC_PATH, '20 領域/專注力.md']
const lookup = buildLinkLookup(PATHS)
const resolve = (target: string, mocPath: string) => resolveWikilinkTargetWithLookup(target, lookup, mocPath)
const options = { path: MOC_PATH, resolve }

function moc(chapters: { what?: string[], when?: string[], unsorted?: string[], whatTitle?: string, whenTitle?: string, tail?: string[] }): string {
  return [
    '---',
    'id: M-20261112-060012-VPB3',
    'kind: domain',
    '---',
    '# 時間管理',
    '',
    '## ① 這個領域在回答什麼',
    '有限的時間怎麼分配？',
    '',
    '## ③ 章節',
    '',
    `### ${chapters.whatTitle ?? '決定做什麼'}`,
    `<!-- ${C_WHAT} -->`,
    ...(chapters.what ?? []),
    '',
    `### ${chapters.whenTitle ?? '什麼時候做'}`,
    `<!-- ${C_WHEN} -->`,
    ...(chapters.when ?? []),
    '',
    ...(chapters.unsorted ? ['### 尚未分章', `<!-- ${C_UNSORTED} -->`, ...chapters.unsorted, ''] : []),
    '## ④ 重點結論',
    ...(chapters.tail ?? ['- 先刪再排 [[筆記A]]']),
    '',
  ].join('\n')
}

const OLD = moc({
  what: ['- [[筆記A]] ── 出發點', '- [[筆記B]] ── 先刪再排'],
  when: ['- [[筆記C]] ── 精力高峰'],
})

function kinds(diffs: readonly ReconcileDiff[]) {
  return diffs.map(diff => diff.kind)
}

function members(raw: string): string[] {
  return [...membershipsFromMocs([parseMoc(raw, MOC_PATH)], (target, mocPath) => resolve(target, mocPath ?? MOC_PATH)).byNote.keys()].sort()
}

describe('reconcileMoc：七種判斷', () => {
  it('沒有改收錄（只改重點結論）→ 沒有差異', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點', '- [[筆記B]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'], tail: ['- 改了結論 [[筆記D]]'] })
    const result = reconcileMoc(OLD, next, options)
    expect(result.diffs).toEqual([])
    expect(result.effective).toBe(next)
  })

  it('刪掉一條收錄行 → remove（記下原章節與關係說明）', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點'], when: ['- [[筆記C]] ── 精力高峰'] })
    const { diffs } = reconcileMoc(OLD, next, options)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ kind: 'remove', notePath: '10 知識/筆記B.md', chapterId: C_WHAT, relation: '先刪再排', mocId: 'M-20261112-060012-VPB3', mocName: '時間管理' })
  })

  it('把收錄行搬到另一章 → move（不是移除再新增）', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點'], when: ['- [[筆記C]] ── 精力高峰', '- [[筆記B]] ── 先刪再排'] })
    const { diffs } = reconcileMoc(OLD, next, options)
    expect(kinds(diffs)).toEqual(['move'])
    expect(diffs[0]).toMatchObject({ notePath: '10 知識/筆記B.md', fromChapterId: C_WHAT, toChapterId: C_WHEN })
  })

  it('改了關係說明 → relation（只改說明）', () => {
    const next = moc({ what: ['- [[筆記A]] ── 整個領域的出發點', '- [[筆記B]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'] })
    const { diffs } = reconcileMoc(OLD, next, options)
    expect(kinds(diffs)).toEqual(['relation'])
    expect(diffs[0]).toMatchObject({ notePath: '10 知識/筆記A.md', before: '出發點', after: '整個領域的出發點', chapterId: C_WHAT })
  })

  it('搬章同時改說明 → move 與 relation 兩條', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點'], when: ['- [[筆記C]] ── 精力高峰', '- [[筆記B]] ── 改過的說明'] })
    expect(kinds(reconcileMoc(OLD, next, options).diffs)).toEqual(['move', 'relation'])
  })

  it('新增一條收錄行 → add（收錄進哪一章、關係說明）', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點', '- [[筆記B]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰', '- [[筆記D]] ── 新加的'] })
    const { diffs } = reconcileMoc(OLD, next, options)
    expect(kinds(diffs)).toEqual(['add'])
    expect(diffs[0]).toMatchObject({ notePath: '10 知識/筆記D.md', chapterId: C_WHEN, relation: '新加的' })
  })

  it('連結指向不存在的筆記：依編號索引找回改名前的筆記 → 修回連結（repaired），歸屬不變', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點', '- [[筆記B 舊名]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'] })
    const result = reconcileMoc(OLD, next, { ...options, recover: target => target === '筆記B 舊名' ? '10 知識/筆記B.md' : null })
    expect(kinds(result.diffs)).toEqual(['broken'])
    expect(result.diffs[0]).toMatchObject({ target: '筆記B 舊名', repairedTo: '筆記B' })
    expect(result.repaired).toContain('- [[筆記B]] ── 先刪再排')
    expect(result.repaired).not.toContain('筆記B 舊名')
    expect(members(result.effective)).toEqual(members(OLD))
  })

  it('連結指向不存在、找不回 → 標斷鏈，不改歸屬（同一章消失的舊收錄保留）', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點', '- [[打錯的標題]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'] })
    const result = reconcileMoc(OLD, next, options)
    expect(kinds(result.diffs)).toEqual(['broken'])
    expect(result.diffs[0]).toMatchObject({ target: '打錯的標題', keptNote: '10 知識/筆記B.md' })
    expect(result.diffs.filter(isEffectiveDiff)).toEqual([])
    expect(result.repaired).toBe(next)
    expect(members(result.effective)).toEqual(members(OLD))
  })

  it('新加一條斷鏈（沒有消失的舊收錄）→ 只提醒斷鏈', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點', '- [[筆記B]] ── 先刪再排', '- [[不存在]] ── 新'], when: ['- [[筆記C]] ── 精力高峰'] })
    const result = reconcileMoc(OLD, next, options)
    expect(kinds(result.diffs)).toEqual(['broken'])
    expect(result.diffs[0]).not.toHaveProperty('keptNote')
  })

  it('收錄行格式壞了（沒有 [[ ]]）→ 當作沒改，原本的歸屬保留', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點', '- 筆記B ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'] })
    const result = reconcileMoc(OLD, next, options)
    expect(kinds(result.diffs)).toEqual(['malformed'])
    expect(result.diffs[0]).toMatchObject({ reason: 'no-link', keptNote: '10 知識/筆記B.md' })
    // 檔案不動（提醒 Scott 自己修），有效內容換回舊收錄行 → 歸屬不變
    expect(result.repaired).toBe(next)
    expect(result.effective).toContain('- [[筆記B]] ── 先刪再排')
    expect(members(result.effective)).toEqual(members(OLD))
    const kept = formalEntries(parseMoc(result.effective, MOC_PATH)).find(({ entry }) => entry.target === '筆記B')
    expect(kept?.chapter.id).toBe(C_WHAT)
  })

  it('收錄行少了 ── → 仍算收錄，說明視為沒改，只提醒', () => {
    const next = moc({ what: ['- [[筆記A]] 出發點', '- [[筆記B]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'] })
    const result = reconcileMoc(OLD, next, options)
    expect(kinds(result.diffs)).toEqual(['malformed'])
    expect(result.diffs[0]).toMatchObject({ reason: 'no-relation', keptNote: '10 知識/筆記A.md' })
  })

  it('連結不在最前面 → 格式壞了，保留原歸屬', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點', '- 參考 [[筆記B]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'] })
    const result = reconcileMoc(OLD, next, options)
    expect(result.diffs).toMatchObject([{ kind: 'malformed', reason: 'link-not-first', keptNote: '10 知識/筆記B.md' }])
    expect(members(result.effective)).toEqual(members(OLD))
  })

  it('改了章節標題 → 依 C 編號判斷是改名，收錄不算搬動', () => {
    const next = moc({ whatTitle: '先決定不做什麼', what: ['- [[筆記A]] ── 出發點', '- [[筆記B]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'] })
    const { diffs } = reconcileMoc(OLD, next, options)
    expect(diffs).toMatchObject([{ kind: 'chapter-rename', chapterId: C_WHAT, before: '決定做什麼', after: '先決定不做什麼' }])
  })

  it('章節沒有 C 編號時依名稱對應；同名就不是搬動', () => {
    const strip = (raw: string) => raw.replace(`<!-- ${C_WHAT} -->\n`, '')
    expect(reconcileMoc(strip(OLD), strip(OLD.replace('出發點', '起點')), options).diffs).toMatchObject([{ kind: 'relation' }])
  })

  it('沒看過的 MOC（舊原文 null）→ 全部算新增，標 unseen', () => {
    const result = reconcileMoc(null, OLD, options)
    expect(result.unseen).toBe(true)
    expect(result.entries).toBe(3)
    expect(kinds(result.diffs)).toEqual(['add', 'add', 'add'])
  })

  it('分家清單（引用）與其他區塊的連結改了不算', () => {
    const grown = (extra: string[]) => OLD.replace('## ④ 重點結論', ['### 怎麼開始 → 已長成 [[專注力]] MOC', ...extra, '', '## ④ 重點結論'].join('\n'))
    expect(reconcileMoc(grown(['- [[筆記E]] ── 引用 `專注力 MOC`']), grown([]), options).diffs).toEqual([])
  })
})

describe('revertDiffs：逐條取消、退回', () => {
  it('把差異反向套回現在的原文，回到舊的收錄狀態，其他區塊的修改保留', () => {
    const next = moc({
      whatTitle: '先決定不做什麼',
      what: ['- [[筆記A]] ── 改過'],
      when: ['- [[筆記C]] ── 精力高峰', '- [[筆記D]] ── 新加的'],
      unsorted: ['- [[筆記B]] ── 先刪再排'],
      tail: ['- Scott 改的結論'],
    })
    const { diffs } = reconcileMoc(OLD, next, options)
    expect(kinds(diffs).sort()).toEqual(['add', 'chapter-rename', 'move', 'relation'])
    const restored = revertDiffs(next, diffs, options)
    expect(reconcileMoc(OLD, restored, options).diffs).toEqual([])
    expect(restored).toContain('- Scott 改的結論')
  })

  it('只取消其中幾條：其餘的保留', () => {
    const next = moc({ what: ['- [[筆記A]] ── 出發點'], when: ['- [[筆記C]] ── 精力高峰', '- [[筆記D]] ── 新加的'] })
    const { diffs } = reconcileMoc(OLD, next, options)
    const remove = diffs.find(diff => diff.kind === 'remove')!
    const restored = revertDiffs(next, [remove], options)
    expect(reconcileMoc(OLD, restored, options).diffs).toMatchObject([{ kind: 'add', notePath: '10 知識/筆記D.md' }])
    expect(restored).toContain('- [[筆記B]] ── 先刪再排')
  })
})

describe('batchCheck：整批檢查門檻', () => {
  const old = moc({ what: NOTES.slice(0, 6).map(path => `- [[${path.split('/').pop()!.replace('.md', '')}]] ── 說明`) })
  const removing = (count: number) => {
    const kept = NOTES.slice(count, 6).map(path => `- [[${path.split('/').pop()!.replace('.md', '')}]] ── 說明`)
    return reconcileMoc(old, moc({ what: kept }), options).diffs
  }

  it('一次存檔移除剛好 4 條 → 不觸發', () => {
    const diffs = removing(4)
    expect(diffs.filter(diff => diff.kind === 'remove')).toHaveLength(4)
    expect(batchCheck(diffs)).toMatchObject({ required: false, removals: 4, reasons: [] })
  })

  it('一次存檔移除 5 條 → 觸發', () => {
    expect(batchCheck(removing(5))).toMatchObject({ required: true, removals: 5, reasons: ['removals'] })
  })

  it('搬動、新增不算移除', () => {
    const next = moc({ when: NOTES.slice(0, 6).map(path => `- [[${path.split('/').pop()!.replace('.md', '')}]] ── 說明`) })
    const diffs = reconcileMoc(old, next, options).diffs
    expect(kinds(diffs).every(kind => kind === 'move')).toBe(true)
    expect(batchCheck(diffs).required).toBe(false)
  })

  it('同一批事件只改到 1 個 MOC → 不觸發；改到 2 個 MOC → 觸發', () => {
    const one = reconcileMoc(OLD, OLD.replace('出發點', '起點'), options).diffs
    expect(batchCheck(one)).toMatchObject({ required: false, mocs: [MOC_PATH] })
    const otherPath = '20 領域/專注力.md'
    const other = reconcileMoc(OLD, OLD.replace('精力高峰', '高峰'), { ...options, path: otherPath }).diffs
    expect(batchCheck([...one, ...other])).toMatchObject({ required: true, reasons: ['mocs'], mocs: [MOC_PATH, otherPath] })
  })

  it('第二個 MOC 只有斷鏈或格式提醒 → 不算改到', () => {
    const one = reconcileMoc(OLD, OLD.replace('出發點', '起點'), options).diffs
    const broken = reconcileMoc(OLD, OLD.replace('[[筆記C]]', '筆記C'), { ...options, path: '20 領域/專注力.md' }).diffs
    expect(kinds(broken)).toEqual(['malformed'])
    expect(batchCheck([...one, ...broken]).required).toBe(false)
  })

  it('整批匯入：沒看過的 MOC 2 個以上，或帶進 5 條以上收錄 → 觸發；1 個 4 條 → 不觸發', () => {
    expect(isBulkImport([{ path: 'a.md', entries: 4 }])).toBe(false)
    expect(isBulkImport([{ path: 'a.md', entries: 5 }])).toBe(true)
    expect(isBulkImport([{ path: 'a.md', entries: 1 }, { path: 'b.md', entries: 1 }])).toBe(true)
    expect(isBulkImport([{ path: 'a.md', entries: 1 }, { path: 'b.md', entries: 0 }])).toBe(false)
    const imported = reconcileMoc(null, old, options)
    expect(imported.entries).toBe(6)
    expect(batchCheck(imported.diffs, { unseen: [{ path: MOC_PATH, entries: imported.entries }] })).toMatchObject({ required: true, reasons: ['import'] })
    const small = reconcileMoc(null, OLD, options)
    expect(batchCheck(small.diffs, { unseen: [{ path: MOC_PATH, entries: small.entries }] }).required).toBe(false)
  })

  it('呼叫端標明整批匯入 → 觸發', () => {
    const one = reconcileMoc(OLD, OLD.replace('出發點', '起點'), options).diffs
    expect(batchCheck(one, { imported: true })).toMatchObject({ required: true, reasons: ['import'] })
  })

  it('沒有會生效的差異 → 不出卡', () => {
    expect(batchCheck([], { imported: true }).required).toBe(false)
  })
})

describe('diffToOpSpec：差異 → 操作', () => {
  const ref = (path: string) => ({ noteId: `N-${path.length}`, noteTitle: path.split('/').pop()!.replace('.md', '') })

  it('五種會生效的差異各對應一種 MOC 操作', () => {
    const next = moc({
      whatTitle: '先決定不做什麼',
      what: ['- [[筆記A]] ── 改過'],
      when: ['- [[筆記C]] ── 精力高峰', '- [[筆記D]] ── 新加的'],
      unsorted: ['- [[筆記B]] ── 先刪再排'],
    })
    const removed = moc({ what: ['- [[筆記A]] ── 出發點'], when: ['- [[筆記C]] ── 精力高峰'] })
    const diffs = [...reconcileMoc(OLD, next, options).diffs, ...reconcileMoc(OLD, removed, options).diffs].filter(isEffectiveDiff)
    const specs = diffs.map(diff => diffToOpSpec(diff, ref))
    expect(specs.map(spec => spec.kind).sort()).toEqual(['moc.chapter.rename', 'moc.entry.add', 'moc.entry.move', 'moc.entry.relation', 'moc.entry.remove'])
    expect(specs.find(spec => spec.kind === 'moc.entry.remove')).toMatchObject({ noteTitle: '筆記B', notePath: '10 知識/筆記B.md', chapterId: C_WHAT, relation: '先刪再排', mocId: 'M-20261112-060012-VPB3' })
    expect(specs.find(spec => spec.kind === 'moc.entry.move')).toMatchObject({ fromChapterId: C_WHAT, toChapterId: C_UNSORTED })
    expect(specs.find(spec => spec.kind === 'moc.chapter.rename')).toMatchObject({ chapterId: C_WHAT, before: '決定做什麼', after: '先決定不做什麼' })
  })
})

describe('applyAppWrites：App 自己寫的不算手動修改', () => {
  it('寫入前＝上次已知狀態、新建、整檔覆寫 → 換成寫入後；寫入前不同（還沒比對的外部修改）→ 不動', async () => {
    const { applyAppWrites } = await import('./reconcile')
    const baselines = new Map([['a.md', { content: 'A0' }], ['b.md', { content: 'B0' }]])
    const changed = applyAppWrites(baselines, [
      { path: 'a.md', before: 'A0', after: 'A1' },
      { path: 'b.md', before: 'B-外部', after: 'B1' },
      { path: 'c.md', before: null, after: 'C1' },
      { path: 'd.md', before: 'D-外部', after: 'D1' },
      { path: 'a.md', before: 'A1', after: 'A2' },
    ])
    expect(changed.sort()).toEqual(['a.md', 'c.md'])
    expect(baselines.get('a.md')?.content).toBe('A2')
    expect(baselines.get('b.md')?.content).toBe('B0')
    expect(baselines.has('d.md')).toBe(false)
  })
})

describe('planReconcile：同一批事件', () => {
  it('第一次啟用（沒有任何上次已知狀態）只建基準', async () => {
    const { planReconcile } = await import('./reconcile')
    const plan = planReconcile({ files: [{ path: MOC_PATH, raw: OLD }], baselines: new Map(), initialized: false, resolve })
    expect(plan.baselineOnly).toHaveLength(1)
    expect(plan.changed).toEqual([])
    expect(plan.check.required).toBe(false)
  })

  it('MOC 改名：依 M 編號找到上次已知狀態，不算新的 MOC', async () => {
    const { planReconcile } = await import('./reconcile')
    const moved = '20 領域/時間管理（新名）.md'
    const plan = planReconcile({ files: [{ path: moved, raw: OLD }], baselines: new Map([[MOC_PATH, { content: OLD, mocId: 'M-20261112-060012-VPB3' }]]), initialized: true, resolve })
    expect(plan.changed).toMatchObject([{ path: moved, movedFrom: MOC_PATH }])
    expect(plan.changed[0].result.diffs).toEqual([])
  })

  it('兩個 MOC 同一批都改了收錄 → 整批檢查', async () => {
    const { planReconcile } = await import('./reconcile')
    const other = '20 領域/專注力.md'
    const plan = planReconcile({
      files: [{ path: MOC_PATH, raw: OLD.replace('出發點', '起點') }, { path: other, raw: OLD.replace('精力高峰', '高峰') }],
      baselines: new Map([[MOC_PATH, { content: OLD }], [other, { content: OLD }]]),
      initialized: true,
      resolve,
    })
    expect(plan.check).toMatchObject({ required: true, reasons: ['mocs'] })
  })

  it('沒變的 MOC 不列；只改其他區塊的 MOC 列進來但沒有差異', async () => {
    const { planReconcile } = await import('./reconcile')
    const tail = moc({ what: ['- [[筆記A]] ── 出發點', '- [[筆記B]] ── 先刪再排'], when: ['- [[筆記C]] ── 精力高峰'], tail: ['- 新結論'] })
    const plan = planReconcile({ files: [{ path: MOC_PATH, raw: tail }, { path: 'x.md', raw: OLD }], baselines: new Map([[MOC_PATH, { content: OLD }], ['x.md', { content: OLD }]]), initialized: true, resolve })
    expect(plan.changed.map(item => item.path)).toEqual([MOC_PATH])
    expect(plan.changed[0].result.diffs).toEqual([])
    expect(plan.check.required).toBe(false)
  })
})
