// Fork（almanac ALMNC-54.10）：工作台的資料源動作接到資料庫與指揮官佇列——照建議處理／處理／不採用／先放著、
// 新增時的 R1／R2 分流、擷取失敗的重試／刪除。資料庫、佇列、本機模型都換成記憶體裡的假的。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canDeleteUnsent, createSource, editSourceContent, transitionSource, type NewSourceInput, type Source, type SourceStatus } from '@/lib/v3-model/source'
import type { SourceJudgement } from './judgement'

const fake = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  judgements: new Map<string, unknown>(),
  kick: vi.fn(async () => ({ analyzed: [], rejected: [], failed: [] })),
  generate: vi.fn(async () => '會議紀錄｜存成紀錄筆記＋拆出任務'),
  available: vi.fn(async () => true),
  capture: vi.fn(async () => ({ status: 'success', title: '頁面', contentMarkdown: '內文', plainText: '' } as Record<string, unknown>)),
  seq: 0,
  v3: true,
  mobile: false,
}))

vi.mock('@/db/v3-sources', () => ({
  addSource: async (input: Omit<NewSourceInput, 'id'> & { id?: string }) => {
    const source = createSource({ ...input, id: input.id ?? `s${++fake.seq}` }, 1000)
    fake.rows.set(source.id, source)
    return source
  },
  addSourceIfAbsent: async (input: NewSourceInput, now = 1000) => {
    if (fake.rows.has(input.id)) return undefined
    const source = createSource(input, now)
    fake.rows.set(source.id, source)
    return source
  },
  getSource: async (id: string) => fake.rows.get(id),
  getLatestVersion: async (rootId: string) => {
    let current = fake.rows.get(rootId) as Source | undefined
    while (current) {
      const next = [...fake.rows.values()].find(row => (row as Source).previousId === current!.id) as Source | undefined
      if (!next) return current
      current = next
    }
    return undefined
  },
  editSource: async (id: string, content: string) => {
    const result = editSourceContent(fake.rows.get(id) as Source, content, 3000, `s${++fake.seq}`)
    fake.rows.set(result.source.id, result.source)
    return result
  },
  listSources: async () => [...fake.rows.values()],
  countOutputsBySource: async () => new Map(),
  setSourceStatus: async (id: string, to: SourceStatus) => {
    const next = transitionSource(fake.rows.get(id) as Source, to, 2000)
    fake.rows.set(id, next)
    return next
  },
  deleteUnsentSource: async (id: string) => {
    if (!canDeleteUnsent(fake.rows.get(id) as Source)) throw new Error('not deletable')
    fake.rows.delete(id)
  },
}))
vi.mock('@/db/v3-source-judgements', () => ({
  saveSourceJudgement: async (judgement: SourceJudgement) => { fake.judgements.set(judgement.sourceId, judgement) },
  getSourceJudgement: async (id: string) => fake.judgements.get(id),
  listSourceJudgements: async () => new Map(fake.judgements as Map<string, SourceJudgement>),
  setFollowSuggestion: async (id: string, on: boolean) => {
    const current = fake.judgements.get(id) as SourceJudgement | undefined
    if (current) fake.judgements.set(id, { ...current, followSuggestion: on })
  },
  deleteSourceJudgement: async (id: string) => { fake.judgements.delete(id) },
}))
vi.mock('@/lib/commander/default-deps', () => ({ commanderQueue: async () => ({ kick: fake.kick }) }))
vi.mock('@/lib/local-model/default', () => ({
  defaultLocalModel: async () => ({ config: { judgeModel: 'qwen3.5:2b' }, available: fake.available, generate: fake.generate, embed: vi.fn() }),
}))
vi.mock('@/lib/web-capture/service', () => ({ capturePublicWebPage: fake.capture }))
vi.mock('@/lib/check', () => ({ isMobileDevice: () => fake.mobile, checkIsTauri: () => false }))
vi.mock('@/lib/fork-ui', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/fork-ui')>()), isUiV3: () => fake.v3 }))

const actions = await import('./actions')
const { default: useWorkbenchStore } = await import('@/stores/workbench')
const { visibleCards } = await import('./put-aside')

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

function status(id: string): SourceStatus | undefined {
  return (fake.rows.get(id) as Source | undefined)?.status
}

beforeEach(() => {
  fake.rows.clear()
  fake.judgements.clear()
  fake.kick.mockClear()
  fake.v3 = true
  fake.mobile = false
  fake.generate.mockClear()
  fake.available.mockResolvedValue(true)
  fake.capture.mockResolvedValue({ status: 'success', title: '頁面', contentMarkdown: '內文', plainText: '' })
  vi.spyOn(console, 'debug').mockImplementation(() => undefined)
})

describe('新增資料源（R1／R2）', () => {
  it.each(['scan', 'image', 'file'] as const)('registers record-dialog %s as one external card with a judgement', async type => {
    const attachment = { markId: 77, type, path: '/data/attachment.png', title: 'attachment.png', collectedAt: 1000 }
    await actions.registerRecordAttachment(attachment)
    await actions.registerRecordAttachment(attachment)
    expect(fake.rows.size).toBe(1)
    expect(fake.rows.get('rec_77')).toMatchObject({ sourceType: 'external', status: 'awaiting_decision', origin: attachment.path })
    expect(useWorkbenchStore.getState().judgements.get('rec_77')).toMatchObject({ status: 'ready', type: expect.any(String) })
    const { buildReviewCards } = await import('./cards')
    const judgement = useWorkbenchStore.getState().judgements.get('rec_77')!
    expect(buildReviewCards({
      now: 1000, proposals: [], awaitingSources: [{ id: 'rec_77', title: attachment.title,
        kindLabel: judgement.type!, judgement: judgement.type!, collectedAt: 1000 }],
    })).toMatchObject([{ kind: 'source', verb: 'judge', summary: judgement.type, sourceId: 'rec_77' }])
    expect(fake.kick).not.toHaveBeenCalled()
    expect(fake.generate).not.toHaveBeenCalled()
  })

  it.each(['classic', 'mobile'])('skips attachment registration in %s', async mode => {
    fake.v3 = mode !== 'classic'
    fake.mobile = mode === 'mobile'
    await actions.registerRecordAttachment({ markId: 77, type: 'scan', path: '/data/scan.png', title: 'scan.png' })
    expect(fake.rows.size).toBe(0)
  })

  it('AC#1: a link → 等你決定 with a one-line judgement in the store; the commander is not called', async () => {
    const rowId = await actions.addNewSource({ type: 'link', content: 'https://example.com/a' })
    await settle()
    const id = rowId.replace('src:', '')
    expect(status(id)).toBe('awaiting_decision')
    expect(fake.kick).not.toHaveBeenCalled()
    expect(fake.capture).toHaveBeenCalledWith('https://example.com/a')
    expect(useWorkbenchStore.getState().judgements.get(id)).toMatchObject({ status: 'ready', type: '會議紀錄', suggestion: '存成紀錄筆記＋拆出任務' })
  })

  it('AC#3 / R2: typed text goes straight to the commander（待分析＋kick）, no judgement', async () => {
    const rowId = await actions.addNewSource({ type: 'text', content: '明天要寄報價單', pastedChars: 0 })
    await settle()
    expect(status(rowId.replace('src:', ''))).toBe('pending_analysis')
    expect(fake.kick).toHaveBeenCalledTimes(1)
    expect(fake.generate).not.toHaveBeenCalled()
  })

  it('pasted content counts as external（等你決定）', async () => {
    const content = '一整段從網頁貼過來的文章內容'
    const rowId = await actions.addNewSource({ type: 'text', content, pastedChars: content.length })
    await settle()
    expect(status(rowId.replace('src:', ''))).toBe('awaiting_decision')
    expect(fake.generate).toHaveBeenCalledTimes(1)
  })

  it('AC#4: ollama not running → the source still waits for a decision, with no judgement line', async () => {
    fake.available.mockResolvedValue(false)
    const rowId = await actions.addNewSource({ type: 'text', content: '貼上的內容', pastedChars: 99 })
    await settle()
    const id = rowId.replace('src:', '')
    expect(status(id)).toBe('awaiting_decision')
    expect(useWorkbenchStore.getState().judgements.get(id)).toMatchObject({ status: 'unavailable' })
  })

  it('capture failure → capture_failed; 重試 succeeds later; 刪除 removes the unsent source', async () => {
    fake.capture.mockResolvedValue({ status: 'blocked', errorCode: 'blocked' })
    const id = (await actions.addNewSource({ type: 'link', content: 'https://example.com/b' })).replace('src:', '')
    await settle()
    expect(fake.judgements.get(id)).toMatchObject({ status: 'capture_failed' })

    fake.capture.mockResolvedValue({ status: 'success', title: '頁面', contentMarkdown: '內文', plainText: '' })
    expect(await actions.retryCapture(id)).toMatchObject({ status: 'ready' })

    fake.capture.mockResolvedValue({ status: 'failed', errorMessage: 'timeout' })
    expect(await actions.retryCapture(id)).toMatchObject({ status: 'capture_failed' })
    await actions.deleteFailedSource(id)
    expect(fake.rows.has(id)).toBe(false)
    expect(fake.judgements.has(id)).toBe(false)
  })
})

describe('匯入的資料源（ALMNC-57：Email、RSS、會議逐字稿）', () => {
  it('外部擷取：等你決定、不叫指揮官；初步判斷一則一則排隊做；同一個 id 再匯入會跳過', async () => {
    let inFlight = 0
    let maxInFlight = 0
    fake.generate.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 0))
      inFlight--
      return '其他｜存成紀錄筆記'
    })
    const inputs = [
      { id: 'src_email:a@x', kind: 'email' as const, content: '主旨 A\n\n內文', origin: 'inbox.mbox' },
      { id: 'src_email:b@x', kind: 'email' as const, content: '主旨 B\n\n內文', origin: 'inbox.mbox' },
    ]
    const first = await actions.addImportedSources(inputs, 5000)
    expect(first.added.map(source => source.id)).toEqual(['src_email:a@x', 'src_email:b@x'])
    expect(first.skipped).toBe(0)
    // 傳進來的順序就是清單順序：第一則的收集時間最新。
    expect(first.added.map(source => source.collectedAt)).toEqual([5000, 4999])
    expect(first.added.every(source => source.sourceType === 'external' && source.status === 'awaiting_decision')).toBe(true)
    for (let i = 0; i < 20; i++) await settle()
    expect(fake.kick).not.toHaveBeenCalled()
    expect(fake.generate).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBe(1)
    expect(useWorkbenchStore.getState().judgements.get('src_email:b@x')).toMatchObject({ status: 'ready', type: '其他' })

    const again = await actions.addImportedSources([inputs[1], { id: 'src_email:c@x', kind: 'email', content: '主旨 C' }], 6000)
    expect(again.added.map(source => source.id)).toEqual(['src_email:c@x'])
    expect(again.skipped).toBe(1)
    fake.generate.mockImplementation(async () => '會議紀錄｜存成紀錄筆記＋拆出任務')
  })
})

describe('等你［資料源］卡的動作（AC#2）', () => {
  async function waiting(): Promise<string> {
    const id = (await actions.addNewSource({ type: 'link', content: 'https://example.com/c' })).replace('src:', '')
    await settle()
    fake.kick.mockClear()
    return id
  }

  it('照建議處理 → 待分析＋交給指揮官，並記下要附上建議', async () => {
    const id = await waiting()
    await actions.processSource(id, { followSuggestion: true })
    expect(status(id)).toBe('pending_analysis')
    expect(fake.kick).toHaveBeenCalledTimes(1)
    expect(fake.judgements.get(id)).toMatchObject({ followSuggestion: true })
  })

  it('處理 → 待分析＋交給指揮官，不附建議', async () => {
    const id = await waiting()
    await actions.processSource(id)
    expect(status(id)).toBe('pending_analysis')
    expect(fake.kick).toHaveBeenCalledTimes(1)
    expect(fake.judgements.get(id)).toMatchObject({ followSuggestion: false })
  })

  it('不採用 → rejected, undo puts it back to 等你決定; the commander is not called', async () => {
    const id = await waiting()
    const undo = await actions.rejectSource(id)
    expect(status(id)).toBe('rejected')
    expect(fake.kick).not.toHaveBeenCalled()
    await undo!()
    expect(status(id)).toBe('awaiting_decision')
  })

  it('先放著 → the card is hidden, the source stays 等你決定', async () => {
    const id = await waiting()
    const card = { key: `source:${id}`, title: 'c' }
    useWorkbenchStore.getState().putAside(card)
    expect(visibleCards([card], useWorkbenchStore.getState().aside, Date.now())).toEqual([])
    expect(status(id)).toBe('awaiting_decision')
  })
})

describe('自己寫的資料源自動交給指揮官（ALMNC-54.10 AC#3，R2）', () => {
  it('語音速記：V3 轉好逐字稿 → 待分析＋叫指揮官一次；同一則再登錄不會重複', async () => {
    await actions.registerVoiceMemo({ markId: 5, transcript: '提醒我明天買牛奶', audioPath: 'rec/5.wav' })
    await actions.registerVoiceMemo({ markId: 5, transcript: '提醒我明天買牛奶', audioPath: 'rec/5.wav' })
    expect(status('rec_5')).toBe('pending_analysis')
    expect(fake.rows.size).toBe(1)
    expect(fake.kick).toHaveBeenCalledTimes(1)
    expect(useWorkbenchStore.getState().sources.some(source => source.id === 'rec_5')).toBe(true)
  })

  it('每日筆記條目與記錄對話框的隨手記：自己打的登錄、貼上的不登錄', async () => {
    await actions.registerDailyEntry({ path: 'Daily/2026-11-22.md', text: '下週二開會', at: 7000 })
    await actions.registerRecordText({ markId: 6, type: 'text', content: '自己打的一段想法', pastedChars: 0 })
    await actions.registerRecordText({ markId: 7, type: 'text', content: '貼上的文章', pastedChars: 99 })
    expect([...fake.rows.keys()].sort()).toEqual(['rec_6', 'src_daily:Daily/2026-11-22.md:7000'])
    expect(fake.kick).toHaveBeenCalledTimes(2)
  })

  it('經典介面不登錄（V3 only）', async () => {
    fake.v3 = false
    await actions.registerVoiceMemo({ markId: 8, transcript: '買牛奶' })
    await actions.registerDailyEntry({ path: 'Daily/x.md', text: '條目' })
    expect(fake.rows.size).toBe(0)
    expect(fake.kick).not.toHaveBeenCalled()
  })

  it('行動版（手機 App）不登錄：手機錄的語音速記不交給指揮官（ALMNC-56 AC #3）', async () => {
    fake.mobile = true
    await actions.registerVoiceMemo({ markId: 10, transcript: '買牛奶' })
    await actions.registerDailyEntry({ path: 'Daily/x.md', text: '條目' })
    await actions.registerRecordText({ markId: 11, type: 'text', content: '自己打的', pastedChars: 0 })
    expect(fake.rows.size).toBe(0)
    expect(fake.kick).not.toHaveBeenCalled()
  })

  it('行動版路由（/mobile）也不登錄', async () => {
    vi.stubGlobal('window', { location: { pathname: '/mobile/record' } })
    try {
      await actions.registerVoiceMemo({ markId: 12, transcript: '買牛奶' })
      expect(fake.rows.size).toBe(0)
      expect(fake.kick).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('登錄失敗不丟錯（不影響原本的存檔）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fake.kick.mockRejectedValueOnce(new Error('queue down'))
    await expect(actions.registerVoiceMemo({ markId: 9, transcript: '買牛奶' })).resolves.toBeUndefined()
  })
})

describe('資料源範圍調整（ALMNC-54.20）', () => {
  it('AC#2 送給指揮官：第一次送建立自己寫的資料源並叫指揮官；內容沒變重送不重複；改了接新版', async () => {
    expect(await actions.sendNoteToCommander({ path: 'work/a.md', content: '# A\n第一版' })).toBe('added')
    expect(fake.rows.get('src_note:work/a.md')).toMatchObject({ sourceType: 'self', status: 'pending_analysis', origin: 'work/a.md' })
    expect(await actions.sendNoteToCommander({ path: 'work/a.md', content: '# A\n第一版' })).toBe('unchanged')
    expect(fake.rows.size).toBe(1)
    expect(fake.kick).toHaveBeenCalledTimes(1)
    expect(await actions.sendNoteToCommander({ path: 'work/a.md', content: '# A\n第二版' })).toBe('versioned')
    expect(fake.rows.size).toBe(2)
    expect([...fake.rows.values()].find(row => (row as Source).previousId === 'src_note:work/a.md')).toMatchObject({ version: 2, status: 'pending_analysis' })
    expect(fake.kick).toHaveBeenCalledTimes(2)
    expect(await actions.sendNoteToCommander({ path: 'work/a.md', content: '' })).toBe('empty')
  })

  it('AC#1 對話結論：V3 建成系統產生的資料源並交給指揮官；重存同一段對話、內容沒變不重複', async () => {
    await actions.registerConversationConclusion({ conversation: 'c1', content: '## 決議\n- 下週出貨', path: '對話摘要/a.md' })
    await actions.registerConversationConclusion({ conversation: 'c1', content: '## 決議\n- 下週出貨', path: '對話摘要/a.md' })
    expect(fake.rows.get('src_conversation:c1')).toMatchObject({ sourceType: 'system', collector: 'system', status: 'pending_analysis' })
    expect(fake.rows.size).toBe(1)
    expect(fake.kick).toHaveBeenCalledTimes(1)
  })

  it('AC#1 指揮官查到的外部資料：查到的建成系統產生的資料源交給指揮官，沒查到的不建；同一期重跑不重複', async () => {
    const findings = [
      { domainId: 'ie', question: '節拍 標準', status: 'found' as const, summary: '依需求計算', sources: [{ title: 't', url: 'https://e.com' }] },
      { domainId: 'ie', question: '換線', status: 'nothing' as const, summary: '', sources: [] },
    ]
    await actions.registerResearchFindings(findings, '2026-W47')
    await actions.registerResearchFindings(findings, '2026-W47')
    expect([...fake.rows.keys()]).toEqual(['src_research:2026-W47:ie:節拍 標準'])
    expect(fake.rows.get('src_research:2026-W47:ie:節拍 標準')).toMatchObject({ sourceType: 'system', status: 'pending_analysis' })
    expect(fake.kick).toHaveBeenCalledTimes(1)
  })

  it('AC#3 錄音照舊自動交給指揮官；選檔的音訊變成外部資料源、等你決定並做初步判斷，不叫指揮官', async () => {
    await actions.registerTranscribedAudio({ from: 'live', markId: 20, transcript: '提醒我買牛奶', audioPath: 'rec/20.wav' })
    expect(status('rec_20')).toBe('pending_analysis')
    expect(fake.kick).toHaveBeenCalledTimes(1)

    await actions.registerTranscribedAudio({ from: 'file', markId: 21, transcript: '一段外部會議錄音的逐字稿', audioPath: 'recordings/21.mp3' })
    await actions.registerTranscribedAudio({ from: 'file', markId: 21, transcript: '一段外部會議錄音的逐字稿', audioPath: 'recordings/21.mp3' })
    await settle()
    expect(fake.rows.get('rec_21')).toMatchObject({ sourceType: 'external', status: 'awaiting_decision', kind: 'transcript', origin: 'recordings/21.mp3' })
    expect(fake.kick).toHaveBeenCalledTimes(1)
    expect(fake.judgements.get('rec_21')).toMatchObject({ status: 'ready', type: '會議紀錄' })
    expect(fake.generate).toHaveBeenCalledTimes(1)
  })

  it('AC#4 經典介面與行動版：對話結論、外部資料、選檔音訊都不登錄', async () => {
    for (const mode of ['classic', 'mobile'] as const) {
      fake.v3 = mode !== 'classic'
      fake.mobile = mode === 'mobile'
      await actions.registerConversationConclusion({ conversation: 'c2', content: '結論' })
      await actions.registerResearchFindings([{ domainId: 'ie', question: 'q', status: 'found', summary: 's', sources: [] }], 'W1')
      await actions.registerTranscribedAudio({ from: 'file', markId: 30, transcript: '外部錄音' })
      await actions.registerTranscribedAudio({ from: 'live', markId: 31, transcript: '錄音' })
    }
    expect(fake.rows.size).toBe(0)
    expect(fake.kick).not.toHaveBeenCalled()
  })
})
