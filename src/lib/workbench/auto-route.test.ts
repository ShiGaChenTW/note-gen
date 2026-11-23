// Fork（almanac ALMNC-54.10，R2）：自己寫的（隨手記、每日筆記條目、語音速記、長文草稿）與系統產生的資料源自動交給指揮官；
// 外部擷取的維持 R1（等你決定，不叫指揮官）。登錄是冪等的：同一個 id 不會建出兩則、也不會再叫一次佇列。
import { describe, expect, it, vi } from 'vitest'
import { createSource, editSourceContent, latestVersions, versionChain, type NewSourceInput, type Source } from '@/lib/v3-model/source'
import { ingestSource } from './judgement'
import {
  conversationConclusionSource, dailyEntrySource, externalAudioSource, noteSource, recordTextSource, researchFindingSource, routeAutoSource,
  routeVersionedSource, systemSource, voiceMemoSource, type AutoRouteDeps, type VersionedRouteDeps,
} from './auto-route'
import { buildSourceRows } from './sources-tab'

function harness() {
  const rows = new Map<string, Source>()
  const kick = vi.fn(async () => undefined)
  const deps: AutoRouteDeps = {
    addIfAbsent: async (input: NewSourceInput) => {
      if (rows.has(input.id)) return undefined
      const source = createSource(input, 1000)
      rows.set(source.id, source)
      return source
    },
    kick,
  }
  return { rows, kick, deps }
}

describe('自己寫的與系統產生的資料源自動交給指揮官（R2）', () => {
  it('隨手記（自己打的字）：登錄成待分析並叫指揮官一次', async () => {
    const { rows, kick, deps } = harness()
    const input = recordTextSource({ markId: 7, type: 'text', content: '明天要跟 A 討論預算', pastedChars: 0 })!
    const result = await routeAutoSource(input, deps)
    expect(result.queued).toBe(true)
    expect(rows.get('rec_7')).toMatchObject({ sourceType: 'self', status: 'pending_analysis', kind: 'text', collector: 'scott' })
    expect(rows.get('rec_7')?.lockedAt).toBeDefined()
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('長文草稿：長長一篇自己打的字一樣自動交出去（長度不影響）', async () => {
    const { rows, kick, deps } = harness()
    const draft = '第一段。\n'.repeat(400)
    const input = recordTextSource({ markId: 8, type: 'text', content: draft, pastedChars: 12 })!
    await routeAutoSource(input, deps)
    expect(rows.get('rec_8')?.status).toBe('pending_analysis')
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('待辦與 Prompt 素材也是自己寫的；Prompt 素材帶來源網址', async () => {
    const { rows, deps } = harness()
    await routeAutoSource(recordTextSource({ markId: 1, type: 'todo', content: '寄報價單' })!, deps)
    await routeAutoSource(recordTextSource({ markId: 2, type: 'prompt-draft', content: '你是一位編輯', origin: 'https://example.com/p' })!, deps)
    expect(rows.get('rec_1')).toMatchObject({ kind: 'todo', status: 'pending_analysis' })
    expect(rows.get('rec_2')).toMatchObject({ kind: 'prompt', origin: 'https://example.com/p', status: 'pending_analysis' })
  })

  it('貼上的內容是外部擷取：不登錄、不叫指揮官（維持 R1）', async () => {
    const { rows, kick } = harness()
    const pasted = '這是從網頁複製貼上的一大段文字'
    expect(recordTextSource({ markId: 9, type: 'text', content: pasted, pastedChars: pasted.length })).toBeUndefined()
    expect(rows.size).toBe(0)
    expect(kick).not.toHaveBeenCalled()
  })

  it('語音速記：逐字稿登錄成資料源，id 與記錄橋接相同、來處是錄音檔', async () => {
    const { rows, kick, deps } = harness()
    const input = voiceMemoSource({ markId: 21, transcript: ' 提醒我明天買牛奶 ', audioPath: 'recordings/1.wav' })!
    const result = await routeAutoSource(input, deps)
    expect(result.queued).toBe(true)
    expect(rows.get('rec_21')).toMatchObject({ sourceType: 'self', kind: 'transcript', content: '提醒我明天買牛奶', origin: 'recordings/1.wav', status: 'pending_analysis' })
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('語音速記沒有逐字稿（辨識失敗）：不登錄', () => {
    expect(voiceMemoSource({ markId: 22, transcript: '   ', audioPath: 'recordings/2.wav' })).toBeUndefined()
  })

  it('每日筆記條目：登錄成待分析，來處是那份每日筆記', async () => {
    const { rows, kick, deps } = harness()
    const input = dailyEntrySource({ path: 'Daily/2026-11-22.md', text: '下週二跟王經理開會', at: 5000 })!
    await routeAutoSource(input, deps)
    const source = rows.get('src_daily:Daily/2026-11-22.md:5000')
    expect(source).toMatchObject({ sourceType: 'self', kind: 'text', origin: 'Daily/2026-11-22.md', collectedAt: 5000, status: 'pending_analysis' })
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('系統產生的（對話結論、任務完成紀錄）：自動交給指揮官', async () => {
    const { rows, kick, deps } = harness()
    await routeAutoSource(systemSource({ id: 'src_system:conv-3', kind: 'text', content: '對話結論：預算上限 50 萬', origin: 'conversation:3' }), deps)
    expect(rows.get('src_system:conv-3')).toMatchObject({ sourceType: 'system', collector: 'system', status: 'pending_analysis' })
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('冪等：同一個 id 登錄兩次只有一則、只叫一次指揮官', async () => {
    const { rows, kick, deps } = harness()
    const input = voiceMemoSource({ markId: 30, transcript: '買牛奶' })!
    const first = await routeAutoSource(input, deps)
    const second = await routeAutoSource(input, deps)
    expect(first.queued).toBe(true)
    expect(second).toEqual({ queued: false })
    expect(rows.size).toBe(1)
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('內容是空白的不登錄', async () => {
    const { rows, kick, deps } = harness()
    expect(await routeAutoSource({ id: 'src_x', sourceType: 'self', kind: 'text', content: '  \n ', collector: 'scott' }, deps)).toEqual({ queued: false })
    expect(rows.size).toBe(0)
    expect(kick).not.toHaveBeenCalled()
  })

  it('外部擷取不能走自動路徑（會丟錯）', async () => {
    const { rows, kick, deps } = harness()
    await expect(routeAutoSource({ id: 'src_e', sourceType: 'external', kind: 'link', content: 'https://example.com', collector: 'scott' } as never, deps)).rejects.toThrow()
    expect(rows.size).toBe(0)
    expect(kick).not.toHaveBeenCalled()
  })

  it('外部擷取走 R1：變成等你決定、背景判斷，不叫指揮官', async () => {
    const { rows } = harness()
    const kick = vi.fn()
    const judge = vi.fn(async () => undefined)
    const source = await ingestSource({ id: 'src_ext', sourceType: 'external' as const, kind: 'link', content: 'https://example.com/a', collector: 'scott' }, {
      add: async input => {
        const created = createSource(input, 1000)
        rows.set(created.id, created)
        return created
      },
      kick,
      judge,
    })
    await Promise.resolve()
    expect(source.status).toBe('awaiting_decision')
    expect(kick).not.toHaveBeenCalled()
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('語音與隨手記登錄後，資料源分頁只列資料源那一則、不重複列出原本的記錄', async () => {
    const { rows, deps } = harness()
    await routeAutoSource(voiceMemoSource({ markId: 40, transcript: '買牛奶' })!, deps)
    const list = buildSourceRows({
      sources: [...rows.values()],
      records: [{ id: 40, type: 'recording', content: '買牛奶', desc: '買牛奶', url: '', createdAt: 900 }],
    })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ origin: 'source', status: 'todo' })
  })
})

// —— ALMNC-54.20 ——

function versionedHarness() {
  const { rows, kick, deps } = harness()
  let seq = 0
  const versioned: VersionedRouteDeps = {
    ...deps,
    latest: async rootId => {
      if (!rows.has(rootId)) return undefined
      const chainEnd = latestVersions([...rows.values()]).find(source => versionChain([...rows.values()], source.id)[0]?.id === rootId)
      return chainEnd
    },
    edit: async (id, content) => {
      const result = editSourceContent(rows.get(id)!, content, 2000 + seq, `v${++seq}`)
      rows.set(result.source.id, result.source)
      return result
    },
  }
  return { rows, kick, deps: versioned }
}

describe('用固定 id 的資料源：重送不重複建立，內容改了接新版（ALMNC-54.20）', () => {
  it('第一次送：登錄成待分析並叫指揮官', async () => {
    const { rows, kick, deps } = versionedHarness()
    const result = await routeVersionedSource(noteSource({ path: 'work/a.md', content: '# A\n內容' })!, deps)
    expect(result).toMatchObject({ outcome: 'added', queued: true })
    expect(rows.get('src_note:work/a.md')).toMatchObject({ sourceType: 'self', status: 'pending_analysis', origin: 'work/a.md', kind: 'text' })
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('內容沒變再送一次：不建立第二則、不再叫指揮官', async () => {
    const { rows, kick, deps } = versionedHarness()
    const input = noteSource({ path: 'work/a.md', content: '# A\n內容' })!
    await routeVersionedSource(input, deps)
    const again = await routeVersionedSource({ ...input, content: '# A\n內容\n' }, deps)
    expect(again).toEqual({ outcome: 'unchanged', queued: false })
    expect(rows.size).toBe(1)
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('內容改了：照版本規則接一版新的（舊版保留、新版連回舊版），叫指揮官分析；之後再改接在最新一版後面', async () => {
    const { rows, kick, deps } = versionedHarness()
    await routeVersionedSource(noteSource({ path: 'work/a.md', content: '第一版' })!, deps)
    const second = await routeVersionedSource(noteSource({ path: 'work/a.md', content: '第二版' })!, deps)
    expect(second).toMatchObject({ outcome: 'versioned', queued: true, source: { id: 'v1', previousId: 'src_note:work/a.md', version: 2, status: 'pending_analysis', content: '第二版' } })
    expect(rows.get('src_note:work/a.md')?.content).toBe('第一版')
    const unchanged = await routeVersionedSource(noteSource({ path: 'work/a.md', content: '第二版' })!, deps)
    expect(unchanged.outcome).toBe('unchanged')
    const third = await routeVersionedSource(noteSource({ path: 'work/a.md', content: '第三版' })!, deps)
    expect(third.source).toMatchObject({ previousId: 'v1', version: 3 })
    expect(kick).toHaveBeenCalledTimes(3)
  })

  it('空的筆記不送', async () => {
    const { rows, deps } = versionedHarness()
    expect(noteSource({ path: 'a.md', content: '  ' })).toBeUndefined()
    expect(await routeVersionedSource({ id: 'src_note:a.md', sourceType: 'self', kind: 'text', content: ' ', collector: 'scott' }, deps)).toEqual({ outcome: 'empty', queued: false })
    expect(rows.size).toBe(0)
  })

  it('對話結論：系統產生的資料源，id 由對話決定，來處是摘要筆記', () => {
    expect(conversationConclusionSource({ conversation: 'sync-1', content: '## 決議\n- 下週出貨', path: '對話摘要/a.md' })).toEqual({
      id: 'src_conversation:sync-1', sourceType: 'system', collector: 'system', kind: 'text', content: '## 決議\n- 下週出貨', origin: '對話摘要/a.md',
    })
    expect(conversationConclusionSource({ conversation: 'sync-1', content: ' ' })).toBeUndefined()
  })

  it('指揮官查到的外部資料：只收查到東西的題目；id 含期別、領域與題目', () => {
    const found = { domainId: 'ie', question: '節拍時間 最新標準', status: 'found' as const, summary: '新標準依需求計算。', sources: [{ title: '標準', url: 'https://example.com/takt' }] }
    expect(researchFindingSource(found, '2026-W47')).toEqual({
      id: 'src_research:2026-W47:ie:節拍時間 最新標準',
      sourceType: 'system',
      collector: 'system',
      kind: 'text',
      content: '節拍時間 最新標準\n\n新標準依需求計算。\n\n- 標準 <https://example.com/takt>',
      origin: 'https://example.com/takt',
    })
    for (const status of ['nothing', 'unavailable', 'failed'] as const) expect(researchFindingSource({ ...found, status }, '2026-W47')).toBeUndefined()
  })

  it('任務完成紀錄不是系統產生的資料源：沒有對應的產生者', async () => {
    const exported = await import('./auto-route')
    expect(Object.keys(exported).filter(name => /task|complet/i.test(name))).toEqual([])
  })

  it('選檔的音訊是外部資料源（R1）：等你決定、不能自動交給指揮官；沒有逐字稿不登錄', async () => {
    const input = externalAudioSource({ markId: 3, transcript: '會議錄音內容', audioPath: 'recordings/a.mp3' })!
    expect(input).toMatchObject({ id: 'rec_3', sourceType: 'external', kind: 'transcript', origin: 'recordings/a.mp3' })
    expect(createSource(input, 1).status).toBe('awaiting_decision')
    const { deps } = harness()
    await expect(routeAutoSource(input as never, deps)).rejects.toThrow()
    expect(externalAudioSource({ markId: 4, transcript: ' ' })).toBeUndefined()
  })
})

describe('ALMNC-69.3 「完成」帶日誌標籤', () => {
  it('noteSource 勾了日誌就帶 journal；一般「送給指揮官」不帶', () => {
    expect(noteSource({ path: 'a.md', content: '內容', journal: true })).toMatchObject({ journal: true, sourceType: 'self' })
    expect(noteSource({ path: 'a.md', content: '內容' })!.journal).toBeUndefined()
  })
})
