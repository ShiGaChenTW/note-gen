// almanac ALMNC-49：休眠畫面測試與樣本共用的幾種日子（只給測試、樣本產生用）。
import zhTW from '../../../../../messages/zh-TW.json'
import { assembleBriefing, type BriefingInputs } from '@/lib/eink/briefing/assemble'
import { DAY, TEXTS, at, fullInputs, pinSnap } from '@/lib/eink/briefing/__fixtures__/inputs'
import type { Briefing } from '@/lib/eink/briefing/types'
import { sleepTextsFromMessages } from '../texts'

export const SLEEP_TEXTS = sleepTextsFromMessages(zhTW, 'zh-TW')
export const UPDATED_AT = new Date(2026, 10, 21, 6, 42).getTime()

const min = (h: number, m = 0) => new Date(2026, 10, 21, h, m).getTime()

type Item = Extract<BriefingInputs['schedule'], { status: 'ok' }>['data']['items'][number]

function event(key: string, title: string, start: number, end: number, extra: Partial<Item> = {}): Item {
  return { key, kind: 'calendar', title, start, end, allDay: false, source: '個人', ...extra }
}

function base(): BriefingInputs {
  const inputs = fullInputs()
  inputs.weather = {
    status: 'ok',
    data: {
      location: '臺北市',
      parts: [
        { part: 'morning', temperature: 14, precipitationProbability: 10, weatherCode: 1 },
        { part: 'noon', temperature: 21, precipitationProbability: 30, weatherCode: 2 },
        { part: 'evening', temperature: 17, precipitationProbability: 80, weatherCode: 61 },
        { part: 'night', temperature: 12, precipitationProbability: 60, weatherCode: 61 },
      ],
      high: 22,
      low: 10,
      precipitationProbability: 80,
      weatherCode: 61,
    },
  }
  // 工作台內容用好認的字，測試才能確認它沒出現在休眠畫面上
  inputs.workbench = {
    status: 'ok',
    data: {
      decide: [{ key: 'd', title: '工作台要決定的事', when: '3d', at: 1 }],
      complete: [{ path: 'a.md', line: 1, title: '工作台要完成的事', due: '2026-11-21', overdue: false }],
    },
  }
  return inputs
}

function withItems(items: Item[], privateItems: string[] = []): Briefing {
  const inputs = base()
  inputs.schedule = { status: 'ok', data: { calendar: 'granted', items } }
  inputs.privateItems = privateItems
  return assembleBriefing(DAY, inputs, TEXTS)
}

/** 一般的一天：全天行程、有地點的會議、長標題、任務。 */
export function normalDay(): Briefing {
  return withItems([
    event('cal:allday', '連假補班日', min(0), 0, { allDay: true, source: '假日' }),
    event('cal:standup', 'almanac 站會', min(9, 30), min(10), { location: '線上' }),
    event('cal:review', 'V3 驗收：對話頁與開工卡，順便確認 CrossPoint 的 SD 外掛下載流程、Wi-Fi 喚醒時間與 1 MB 下載上限的實際行為，會後整理成驗收紀錄', min(11), min(12, 30), { location: '公司 3F 會議室' }),
    event('task:a.md#寄報價', '寄報價給客戶', min(15), 0, { kind: 'task', source: 'a.md' }),
    event('cal:dentist', '牙醫回診', min(14), min(15), { location: '信義路診所' }),
    event('cal:book', '讀書會', min(19, 30), min(21)),
  ])
}

/** 行程超過 8 件：11 件有時間的＋1 件全天。 */
export function busyDay(): Briefing {
  const items: Item[] = [event('cal:allday', '員工旅遊報名截止', min(0), 0, { allDay: true })]
  for (let i = 0; i < 11; i++) items.push(event(`cal:${i}`, `第 ${i + 1} 件行程`, min(8 + i), min(8 + i, 45), i % 3 === 0 ? { location: `地點 ${i + 1}` } : {}))
  return withItems(items)
}

/** 私人行程：一般的與全天的各一件。 */
export function privateDay(): Briefing {
  return withItems([
    event('cal:allday-private', '家人生日', min(0), 0, { allDay: true }),
    event('cal:open', '產品週會', min(10), min(11), { location: '大會議室' }),
    event('cal:secret', '心理諮商', min(13), min(14), { location: '某某診所' }),
    event('cal:public', '寫週報', min(16), min(17)),
  ], ['cal:allday-private', 'cal:secret'])
}

/** 沒有行程的日子：時間軸位置改放每日回顧卡。 */
export function emptyDay(): Briefing {
  const inputs = base()
  inputs.schedule = { status: 'ok', data: { calendar: 'granted', items: [] } }
  if (inputs.pins.status === 'ok') {
    inputs.pins.data = [
      pinSnap('知識/間隔重複.md', 0, { firstSentAt: at(3), lastSentAt: at(4) },
        '# 間隔重複\n\n間隔重複是把複習排在快要忘記的時候：第一次隔一天、再隔三天、再隔一週，每次成功回想就把間隔拉長。重點不是複習的次數，而是每次都在「有點難想起來」的時候提取，提取本身才是讓記憶變牢的動作。'),
    ]
  }
  return assembleBriefing(DAY, inputs, TEXTS)
}

/** 天氣抓不到＋行事曆沒授權。 */
export function unavailableDay(): Briefing {
  const inputs = base()
  inputs.weather = { status: 'error' }
  inputs.schedule = { status: 'denied' }
  return assembleBriefing(DAY, inputs, TEXTS)
}
