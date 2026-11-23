// almanac ALMNC-10：收集提案保存到 store.json，重開後還在；圖片資料與復原資料不存。
import { describe, expect, it } from 'vitest'
import { COLLECT_ITEMS_KEY, DECIDED_KEEP_MS, loadItems, mergeItems, parseItems, saveItems, serializeItems, type CollectStorage } from './persist'

const base = { body: '', due: '', time: '', tags: [] as string[] }
const NOW = Date.UTC(2026, 10, 18)

function fakeStorage(initial?: unknown): CollectStorage & { data: Map<string, unknown>, saves: number } {
  const data = new Map<string, unknown>(initial === undefined ? [] : [[COLLECT_ITEMS_KEY, initial]])
  return { data, saves: 0, get: async key => data.get(key), set: async (key, value) => { data.set(key, value) }, async save() { this.saves += 1 } }
}

const item = (over: Record<string, unknown> = {}) => ({
  id: 'c1', createdAt: NOW - 1000, state: 'ready' as const, source: 'ai' as const,
  input: { kind: 'image' as const, text: '白板', name: 'a.png', imageDataUrl: 'data:image/png;base64,AAAA' },
  proposals: [
    { ...base, id: 'p1', kind: 'task' as const, title: '甲', status: 'wait' as const },
    { ...base, id: 'p2', kind: 'event' as const, title: '乙', time: '10:00', status: 'ok' as const, result: { path: 'd.md', record: { writes: [{ path: 'd.md', before: 'x'.repeat(1000), after: 'y' }] } } },
  ],
  ...over,
})

describe('serializeItems', () => {
  it('只存拆完的項目，不存圖片資料網址與復原資料', () => {
    const out = serializeItems([item(), item({ id: 'c2', state: 'reading', proposals: [] })])
    expect(out).toHaveLength(1)
    expect(JSON.stringify(out)).not.toContain('data:image')
    expect(JSON.stringify(out)).not.toContain('xxxx')
    expect(out[0].proposals[1].result).toEqual({ path: 'd.md' })
  })
})

describe('parseItems', () => {
  it('寫了再讀回來內容一致，wait 的提案還是 wait', async () => {
    const storage = fakeStorage()
    await saveItems([item()], storage)
    expect(storage.saves).toBe(1)
    const [restored] = await loadItems(NOW, storage)
    expect(restored.proposals.map(p => p.status)).toEqual(['wait', 'ok'])
    expect(restored.input).toEqual({ kind: 'image', text: '白板', name: 'a.png' })
  })
  it('壞資料略過、不丟例外', () => {
    expect(parseItems('nope', NOW)).toEqual([])
    expect(parseItems([null, 3, { id: 'x' }, { id: 'y', createdAt: NOW, input: { kind: 'zip', text: '' } }], NOW)).toEqual([])
    const [only] = parseItems([{ ...item(), proposals: [{ id: 'bad' }, ...item().proposals] }], NOW)
    expect(only.proposals).toHaveLength(2)
  })
  it('處理完又太舊的項目丟掉，還有 wait 的一直留著', () => {
    const old = NOW - DECIDED_KEEP_MS - 1
    const decided = item({ id: 'done', createdAt: old, proposals: [{ ...base, id: 'p', kind: 'task', title: 'x', status: 'ok' }] })
    const waiting = item({ id: 'wait', createdAt: old })
    expect(parseItems([decided, waiting], NOW).map(entry => entry.id)).toEqual(['wait'])
  })
})

describe('mergeItems', () => {
  it('記憶體裡的優先，依建立時間新的在前', () => {
    const merged = mergeItems([{ id: 'a', createdAt: 5, v: 'mem' }], [{ id: 'a', createdAt: 5, v: 'disk' }, { id: 'b', createdAt: 9, v: 'disk' }])
    expect(merged).toEqual([{ id: 'b', createdAt: 9, v: 'disk' }, { id: 'a', createdAt: 5, v: 'mem' }])
  })
})

// Fork（almanac ALMNC-54.5）：提案記錄來自哪段對話，重開後還在。
describe('proposal source conversation', () => {
  it('keeps the revision’s write operations and workbench label through save and load', () => {
    const proposal = {
      ...base, id: 'p1', kind: 'note' as const, title: '改筆記', status: 'wait' as const,
      previousProposalId: 'collect:c0:p1',
      edits: [{ path: 'a.md', baseContent: '舊', content: '修訂', summary: '改筆記' }],
      card: { label: 'knowledge' as const, verb: 'modify' as const },
    }
    const saved = serializeItems([item({ proposals: [proposal] })])
    expect(parseItems(saved, NOW)[0].proposals[0]).toMatchObject(proposal)
  })

  it('keeps conversationId and previousProposalId through save and load', () => {
    const saved = serializeItems([item({ proposals: [{ ...base, id: 'p1', kind: 'task', title: '甲', status: 'wait', conversationId: 12, previousProposalId: 'collect:c0:p1' }] })])
    expect(saved[0].proposals[0]).toMatchObject({ conversationId: 12, previousProposalId: 'collect:c0:p1' })
    expect(parseItems(saved, NOW)[0].proposals[0]).toMatchObject({ conversationId: 12, previousProposalId: 'collect:c0:p1' })
  })
  // Fork（almanac ALMNC-54.21 AC#4）：卡片上改過的存放位置（含最上層 ''）存檔後還在；往上跳的不收。
  it('keeps the folder chosen on the card through save and load', () => {
    const saved = serializeItems([item({ proposals: [
      { ...base, id: 'p1', kind: 'note', title: '甲', status: 'wait', folder: '10 Projects/產線' },
      { ...base, id: 'p2', kind: 'note', title: '乙', status: 'wait', folder: '' },
      { ...base, id: 'p3', kind: 'note', title: '丙', status: 'wait' },
    ] })])
    const [p1, p2, p3] = parseItems(saved, NOW)[0].proposals
    expect(p1.folder).toBe('10 Projects/產線')
    expect(p2.folder).toBe('')
    expect('folder' in p3).toBe(false)
    const [bad] = parseItems([{ ...item(), proposals: [{ ...base, id: 'p4', kind: 'note', title: '丁', status: 'wait', folder: '../外面' }] }], NOW)[0].proposals
    expect(bad).toMatchObject({ id: 'p4', title: '丁' })
    expect('folder' in bad).toBe(false)
  })

  // Fork（almanac ALMNC-69.2）：新增筆記的原建議存檔後還在；型別不對只丟這個欄位。
  it('keeps the original suggestion through save and load', () => {
    const saved = serializeItems([item({ proposals: [
      { ...base, id: 'p1', kind: 'note', title: '新', status: 'ok', suggested: { title: '舊', folder: '' } },
      { ...base, id: 'p2', kind: 'note', title: '乙', status: 'wait', suggested: { title: '甲' } },
    ] })])
    const [p1, p2] = parseItems(saved, NOW)[0].proposals
    expect(p1.suggested).toEqual({ title: '舊', folder: '' })
    expect(p2.suggested).toEqual({ title: '甲' })
    const [bad] = parseItems([{ ...item(), proposals: [{ ...base, id: 'p3', kind: 'note', title: '丙', status: 'wait', suggested: { title: 3 } }] }], NOW)[0].proposals
    expect(bad).toMatchObject({ id: 'p3', title: '丙' })
    expect('suggested' in bad).toBe(false)
  })

  it('drops only malformed link fields, not the proposal', () => {
    const raw = [{ ...item(), proposals: [{ ...base, id: 'p1', kind: 'task', title: '甲', status: 'wait', conversationId: 'x', previousProposalId: 3 }] }]
    const [proposal] = parseItems(raw, NOW)[0].proposals
    expect(proposal.id).toBe('p1')
    expect(proposal).not.toHaveProperty('conversationId')
    expect(proposal).not.toHaveProperty('previousProposalId')
  })
})

// Fork（almanac ALMNC-54.7）：右側欄指揮官的檔案變更提案，重開後還能接受。
describe('file change proposals', () => {
  const change = { toolName: 'note_update_file', args: { filePath: 'a.md', content: 'new' }, kind: 'update' as const, path: 'a.md', content: 'new', baseContent: 'old', summary: '修改 a.md（1 → 1 行）' }
  it('keeps the change through save and load', () => {
    const saved = serializeItems([item({ proposals: [{ ...base, id: 'p1', kind: 'note', title: change.summary, status: 'wait', conversationId: 7, change }] })])
    expect(parseItems(saved, NOW)[0].proposals[0]).toMatchObject({ conversationId: 7, change })
  })
  it('drops a proposal whose change cannot be read', () => {
    const raw = [{ ...item(), proposals: [{ ...base, id: 'p1', kind: 'note', title: 'x', status: 'wait', change: { kind: 'update' } }, { ...base, id: 'p2', kind: 'task', title: '乙', status: 'wait' }] }]
    expect(parseItems(raw, NOW)[0].proposals.map(proposal => proposal.id)).toEqual(['p2'])
  })
})

// Fork（almanac ALMNC-69.7）：清理提案的領域承接（合併、取代）重開後還在，接受時才能寫 MOC。
describe('membership transfers', () => {
  it('keeps membershipTransfers through save and load', () => {
    const membershipTransfers = [{ from: 'k/a.md', to: 'k/b.md' }]
    const saved = serializeItems([item({ proposals: [{ ...base, id: 'p1', kind: 'note', title: '取代', status: 'wait', membershipTransfers }] })])
    expect(parseItems(saved, NOW)[0].proposals[0]).toMatchObject({ membershipTransfers })
  })
})
