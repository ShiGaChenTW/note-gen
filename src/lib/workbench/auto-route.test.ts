// Fork（almanac ALMNC-54.10，R2）：自己寫的（隨手記、每日筆記條目、語音速記、長文草稿）與系統產生的資料源自動交給指揮官；
// 外部擷取的維持 R1（等你決定，不叫指揮官）。登錄是冪等的：同一個 id 不會建出兩則、也不會再叫一次佇列。
import { describe, expect, it, vi } from 'vitest'
import { createSource, type NewSourceInput, type Source } from '@/lib/v3-model/source'
import { ingestSource } from './judgement'
import { dailyEntrySource, recordTextSource, routeAutoSource, systemSource, voiceMemoSource, type AutoRouteDeps } from './auto-route'
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
