// almanac ALMNC-47：今日簡報組裝（章節順序、確定性、各來源沒資料／沒授權時的處理、釘選第一天全文、文章與回顧卡的挑選順序）。
import { describe, expect, it } from 'vitest'
import en from '../../../../messages/en.json'
import zh from '../../../../messages/zh.json'
import zhTW from '../../../../messages/zh-TW.json'
import { assembleBriefing, pickReviewCards, reviewExcerpt } from './assemble'
import { DAY, TEXTS, article, at, fullInputs, pinSnap } from './__fixtures__/inputs'
import { briefingTextsFromMessages } from './texts'
import type { ArticlesChapter, BriefingChapter, PinnedChapter, ReviewChapter, ScheduleChapter, WeatherChapter, WorkbenchChapter } from './types'

function chapter<T extends BriefingChapter>(chapters: BriefingChapter[], kind: T['kind']): T | undefined {
  return chapters.find(item => item.kind === kind) as T | undefined
}

describe('章節順序與內容', () => {
  it('依卡片順序：行程 → 天氣 → 釘選 → 精選文章 → 回顧卡 → 知識報告 → 工作台摘要', () => {
    const briefing = assembleBriefing(DAY, fullInputs(), TEXTS)
    expect(briefing.date).toBe('2026-11-21')
    expect(briefing.chapters.map(item => [item.kind, item.title])).toEqual([
      ['schedule', '今天行程'],
      ['weather', '天氣'],
      ['pinned', '釘選資料'],
      ['articles', '每日精選文章'],
      ['review', '每日回顧卡'],
      ['report', '知識報告'],
      ['workbench', '工作台摘要'],
    ])
    expect(briefing.omitted).toEqual([])
  })

  it('行程：整天的在前、依開始時間排；私人行程保留完整資料並標 private', () => {
    const schedule = chapter<ScheduleChapter>(assembleBriefing(DAY, fullInputs(), TEXTS).chapters, 'schedule')!
    expect(schedule.items.map(item => [item.title, item.private])).toEqual([['連假', false], ['寄報價', false], ['看牙醫', true]])
  })

  it('工作台摘要：要決定依進來的時間、要完成逾期在前，附總數', () => {
    const workbench = chapter<WorkbenchChapter>(assembleBriefing(DAY, fullInputs(), TEXTS).chapters, 'workbench')!
    expect(workbench.decide.map(item => item.title)).toEqual(['第一', '第二'])
    expect(workbench.complete.map(item => item.title)).toEqual(['逾期', '今天'])
    expect([workbench.decideCount, workbench.completeCount]).toEqual([2, 2])
  })

  it('設定頁沒勾的章節整章拿掉；天氣跟著「今天行程」開關', () => {
    const briefing = assembleBriefing(DAY, { ...fullInputs(), settings: { sections: ['pinned', 'workbench'] } }, TEXTS)
    expect(briefing.chapters.map(item => item.kind)).toEqual(['pinned', 'workbench'])
    expect(briefing.omitted.filter(item => item.reason === 'disabled').map(item => item.kind)).toEqual(['schedule', 'weather', 'articles', 'review', 'report'])
    expect(briefing.sent.articleUrls).toEqual([])
    expect(briefing.sent.reportPeriod).toBeUndefined()
  })
})

describe('確定性（AC1）', () => {
  it('同一天、同樣的狀態組兩次結果完全相同；一天中的不同時間也一樣', () => {
    const first = assembleBriefing(DAY, fullInputs(), TEXTS)
    expect(assembleBriefing(DAY, fullInputs(), TEXTS)).toEqual(first)
    expect(assembleBriefing(new Date(2026, 10, 21, 23, 59), fullInputs(), TEXTS)).toEqual(first)
  })

  it('來源給的順序不同也得到同一份（排序鍵都寫明）', () => {
    const shuffled = fullInputs()
    if (shuffled.readLater.status === 'ok') shuffled.readLater.data.reverse()
    if (shuffled.pins.status === 'ok') shuffled.pins.data.reverse()
    if (shuffled.schedule.status === 'ok') shuffled.schedule.data.items.reverse()
    expect(assembleBriefing(DAY, shuffled, TEXTS)).toEqual(assembleBriefing(DAY, fullInputs(), TEXTS))
  })

  it('組裝不改輸入（已送狀態只在 commitSent 更新）', () => {
    const inputs = fullInputs()
    const snapshot = structuredClone(inputs)
    assembleBriefing(DAY, inputs, TEXTS)
    expect(inputs).toEqual(snapshot)
  })
})

describe('來源沒資料或沒授權（AC2–AC4）', () => {
  it('行事曆沒授權、也沒有其他行程：章節保留並說明，其他章照常', () => {
    const briefing = assembleBriefing(DAY, { ...fullInputs(), schedule: { status: 'denied' } }, TEXTS)
    expect(chapter<ScheduleChapter>(briefing.chapters, 'schedule')).toMatchObject({ status: 'unavailable', note: '行事曆沒有授權，讀不到今天的行程。', items: [] })
    expect(briefing.chapters).toHaveLength(7)
  })

  it('行事曆沒授權但有任務與時段：照常列出並附說明', () => {
    const inputs = fullInputs()
    if (inputs.schedule.status === 'ok') inputs.schedule.data = { calendar: 'denied', items: inputs.schedule.data.items.filter(item => item.kind !== 'calendar') }
    const schedule = chapter<ScheduleChapter>(assembleBriefing(DAY, inputs, TEXTS).chapters, 'schedule')!
    expect(schedule).toMatchObject({ status: 'ok', note: '行事曆沒有授權，這裡只列出時段與有時間的任務。' })
    expect(schedule.items).toHaveLength(1)
  })

  it('今天沒有行程：章節保留並說明', () => {
    const briefing = assembleBriefing(DAY, { ...fullInputs(), schedule: { status: 'ok', data: { calendar: 'granted', items: [] } } }, TEXTS)
    expect(chapter<ScheduleChapter>(briefing.chapters, 'schedule')).toMatchObject({ status: 'empty', note: '今天沒有行程。' })
  })

  it('天氣 API 失敗：顯示「天氣暫無資料」，不擋產生', () => {
    const briefing = assembleBriefing(DAY, { ...fullInputs(), weather: { status: 'error', message: 'HTTP 500' } }, TEXTS)
    expect(chapter<WeatherChapter>(briefing.chapters, 'weather')).toEqual({ kind: 'weather', title: '天氣', status: 'unavailable', note: '天氣暫無資料', weather: null })
    expect(briefing.chapters).toHaveLength(7)
  })

  it('沒填天氣地點：也是「天氣暫無資料」，附設定提示', () => {
    const weather = chapter<WeatherChapter>(assembleBriefing(DAY, { ...fullInputs(), weather: { status: 'empty' } }, TEXTS).chapters, 'weather')!
    expect(weather.note).toMatch(/^天氣暫無資料/)
  })

  it('沒有知識報告：整章拿掉，其他章照常', () => {
    const briefing = assembleBriefing(DAY, { ...fullInputs(), report: { status: 'empty' } }, TEXTS)
    expect(briefing.chapters.map(item => item.kind)).not.toContain('report')
    expect(briefing.omitted).toEqual([{ kind: 'report', reason: 'empty' }])
    expect(briefing.chapters).toHaveLength(6)
    expect(briefing.sent.reportPeriod).toBeUndefined()
  })

  it('知識報告沒有新一期（上次送過同一期、不是今天）：整章拿掉', () => {
    const briefing = assembleBriefing(DAY, { ...fullInputs(), log: { reviewShown: {}, report: { period: '2026-W47', sentAt: at(18) } } }, TEXTS)
    expect(briefing.omitted).toEqual([{ kind: 'report', reason: 'not-new' }])
  })

  it('釘選清單是空的：釘選資料與回顧卡都拿掉，其他章照常', () => {
    const briefing = assembleBriefing(DAY, { ...fullInputs(), pins: { status: 'empty' } }, TEXTS)
    expect(briefing.omitted).toEqual([{ kind: 'pinned', reason: 'empty' }, { kind: 'review', reason: 'empty' }])
    expect(briefing.chapters.map(item => item.kind)).toEqual(['schedule', 'weather', 'articles', 'report', 'workbench'])
    expect(briefing.appendix).toEqual([])
  })

  it('稍後讀清單是空的：精選文章 0 篇，整章拿掉、不從別處補', () => {
    const briefing = assembleBriefing(DAY, { ...fullInputs(), readLater: { status: 'empty' } }, TEXTS)
    expect(briefing.omitted).toEqual([{ kind: 'articles', reason: 'empty' }])
    expect(briefing.chapters).toHaveLength(6)
    expect(briefing.sent.articleUrls).toEqual([])
  })

  it('稍後讀只剩無法擷取或已送出的：也算 0 篇，整章拿掉', () => {
    const readLater = { status: 'ok' as const, data: [article(1, { status: 'unextractable', error: 'paywall' }), article(2, { status: 'sent', sentAt: at(10) })] }
    expect(assembleBriefing(DAY, { ...fullInputs(), readLater }, TEXTS).omitted).toEqual([{ kind: 'articles', reason: 'empty' }])
  })

  it('工作台讀不到：章節保留並說明；沒事時也說明', () => {
    const broken = assembleBriefing(DAY, { ...fullInputs(), workbench: { status: 'error' } }, TEXTS)
    expect(chapter<WorkbenchChapter>(broken.chapters, 'workbench')).toMatchObject({ status: 'unavailable', note: '工作台摘要讀取失敗。' })
    const idle = assembleBriefing(DAY, { ...fullInputs(), workbench: { status: 'ok', data: { decide: [], complete: [] } } }, TEXTS)
    expect(chapter<WorkbenchChapter>(idle.chapters, 'workbench')).toMatchObject({ status: 'empty', note: '沒有要決定或要完成的事。' })
  })

  it('所有來源都壞掉時仍產生一份簡報', () => {
    const briefing = assembleBriefing(DAY, {
      ...fullInputs(),
      schedule: { status: 'error' },
      weather: { status: 'error' },
      pins: { status: 'error' },
      readLater: { status: 'error' },
      report: { status: 'error' },
      workbench: { status: 'error' },
    }, TEXTS)
    expect(briefing.chapters.map(item => [item.kind, item.status])).toEqual([['schedule', 'unavailable'], ['weather', 'unavailable'], ['workbench', 'unavailable']])
    expect(briefing.sent).toEqual({ articleUrls: [], pinPaths: [], reviewPaths: [] })
  })
})

describe('釘選資料：第一天全文，之後只列標題、全文進附錄', () => {
  it('還沒送過的放全文；更早送過的只列標題並放進附錄；讀不到的只列標題', () => {
    const briefing = assembleBriefing(DAY, fullInputs(), TEXTS)
    const pinned = chapter<PinnedChapter>(briefing.chapters, 'pinned')!
    expect(pinned.items).toEqual([
      { path: '新.md', title: '新', mode: 'full', content: '# 新.md\n\n新.md 的重點段落。' },
      { path: '舊.md', title: '舊', mode: 'title', appendixId: 'pin:舊.md' },
      { path: '不見了.md', title: '不見了', mode: 'missing' },
    ])
    expect(briefing.appendix).toEqual([{ id: 'pin:舊.md', kind: 'pin', path: '舊.md', title: '舊', content: '# 舊.md\n\n舊.md 的重點段落。' }])
    expect(briefing.sent.pinPaths).toEqual(['新.md', '舊.md'])
  })

  it('第一次送出就是今天：今天重算仍放全文；隔天才只列標題', () => {
    const inputs = { ...fullInputs(), pins: { status: 'ok' as const, data: [pinSnap('新.md', 0, { firstSentAt: at(21, 7), lastSentAt: at(21, 7) })] } }
    expect(chapter<PinnedChapter>(assembleBriefing(DAY, inputs, TEXTS).chapters, 'pinned')!.items[0].mode).toBe('full')
    expect(chapter<PinnedChapter>(assembleBriefing(new Date(2026, 10, 22, 6), inputs, TEXTS).chapters, 'pinned')!.items[0].mode).toBe('title')
  })
})

describe('每日精選文章：最早存的先送，3 篇', () => {
  it('從待送且有正文的取最早存的 3 篇', () => {
    const briefing = assembleBriefing(DAY, fullInputs(), TEXTS)
    const articles = chapter<ArticlesChapter>(briefing.chapters, 'articles')!
    expect(articles.items.map(item => item.title)).toEqual(['文章 2', '文章 3', '文章 4'])
    expect(briefing.sent.articleUrls).toEqual(['https://ex.com/2', 'https://ex.com/3', 'https://ex.com/4'])
  })

  it('今天已經送出的留在今天的結果裡，不足 3 篇才從待送補', () => {
    const readLater = { status: 'ok' as const, data: [article(1), article(2), article(3, { status: 'sent', sentAt: at(21, 7) }), article(4)] }
    const articles = chapter<ArticlesChapter>(assembleBriefing(DAY, { ...fullInputs(), readLater }, TEXTS).chapters, 'articles')!
    expect(articles.items.map(item => item.title)).toEqual(['文章 1', '文章 2', '文章 3'])
  })
})

describe('每日回顧卡：從送過的釘選資料抽 3 張，最久沒出現的先抽', () => {
  const sentBefore = (path: string, order: number, firstSentAt: number) => pinSnap(path, order, { firstSentAt, lastSentAt: firstSentAt })
  const start = new Date(2026, 10, 21).getTime()
  const end = new Date(2026, 10, 22).getTime()

  it('沒出現過的最先，其次最後出現時間由舊到新；平手看第一次送出時間，再看路徑', () => {
    const pins = [
      sentBefore('d.md', 0, at(5)),
      sentBefore('c.md', 1, at(5)),
      sentBefore('b.md', 2, at(3)),
      sentBefore('a.md', 3, at(4)),
      sentBefore('今天才送.md', 4, at(21, 7)),
      pinSnap('沒送過.md', 5),
    ]
    const log = { reviewShown: { 'a.md': at(18), 'b.md': at(12) } }
    expect(pickReviewCards(pins, log, start, end).map(card => card.path)).toEqual(['c.md', 'd.md', 'b.md'])
    expect(pickReviewCards(pins, { reviewShown: { 'a.md': at(18), 'b.md': at(12), 'c.md': at(19), 'd.md': at(19) } }, start, end).map(card => card.path))
      .toEqual(['b.md', 'a.md', 'c.md'])
  })

  it('今天已經出現過的留在今天的結果裡', () => {
    const pins = [sentBefore('a.md', 0, at(1)), sentBefore('b.md', 1, at(2)), sentBefore('c.md', 2, at(3)), sentBefore('d.md', 3, at(4))]
    const log = { reviewShown: { 'd.md': at(21, 7) } }
    expect(pickReviewCards(pins, log, start, end).map(card => card.path)).toEqual(['d.md', 'a.md', 'b.md'])
  })

  it('只從今天以前送過的抽；讀不到內容或沒有文字的不抽', () => {
    const pins = [sentBefore('空.md', 0, at(1)), { ...sentBefore('不見.md', 1, at(1)), content: null }, pinSnap('沒送過.md', 2)]
    pins[0].content = '# 只有標題'
    expect(pickReviewCards(pins, { reviewShown: {} }, start, end)).toEqual([])
    const briefing = assembleBriefing(DAY, { ...fullInputs(), pins: { status: 'ok', data: pins } }, TEXTS)
    expect(briefing.omitted).toContainEqual({ kind: 'review', reason: 'empty' })
  })

  it('組裝時的回顧卡內容與 sent 清單', () => {
    const briefing = assembleBriefing(DAY, fullInputs(), TEXTS)
    expect(chapter<ReviewChapter>(briefing.chapters, 'review')!.items).toEqual([{ path: '舊.md', title: '舊', excerpt: '舊.md 的重點段落。' }])
    expect(briefing.sent.reviewPaths).toEqual(['舊.md'])
  })
})

describe('reviewExcerpt', () => {
  it('跳過 frontmatter、標題、程式碼與圖片，取第一段並去掉連結語法', () => {
    const md = '---\ntitle: x\n---\n# 標題\n\n![圖](a.png)\n\n```js\ncode\n```\n\n- 第一點 [[筆記|別名]]\n- 第二點 [連結](https://x)\n\n第二段'
    expect(reviewExcerpt(md)).toBe('第一點 別名 第二點 連結')
  })

  it('超過上限截斷並加刪節號（以字計，不切壞中文）', () => {
    expect(reviewExcerpt('一二三四五六', 4)).toBe('一二三四…')
  })
})

describe('字串（zh-TW／zh／en 同一組鍵）', () => {
  const keys = (value: unknown, prefix = ''): string[] => (
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
      : [prefix]
  )
  it('三個語系的 eink.briefing 鍵完全相同，且都有值', () => {
    const zhTWKeys = keys(zhTW.eink.briefing).sort()
    expect(keys(zh.eink.briefing).sort()).toEqual(zhTWKeys)
    expect(keys(en.eink.briefing).sort()).toEqual(zhTWKeys)
    for (const messages of [zhTW, zh, en]) {
      const texts = briefingTextsFromMessages(messages, 'x')
      for (const value of [...Object.values(texts.chapters), ...Object.values(texts.notes), ...Object.values(texts.dayParts), texts.privateLabel]) {
        expect(value).toBeTruthy()
        expect(value).not.toMatch(/^eink\./)
      }
    }
  })

  it('天氣抓不到的字樣照計畫：「天氣暫無資料」', () => {
    expect(TEXTS.notes.weatherUnavailable).toBe('天氣暫無資料')
  })
})
