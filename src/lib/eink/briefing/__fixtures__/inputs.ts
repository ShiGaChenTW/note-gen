// almanac ALMNC-47：今日簡報測試共用的假資料（七個來源都有資料的一天）。只給測試用。
import zhTW from '../../../../../messages/zh-TW.json'
import type { EinkPin } from '@/lib/eink/pins'
import type { ReadLaterItem } from '@/lib/eink/read-later'
import { BRIEFING_SECTIONS } from '@/lib/eink/settings'
import type { BriefingInputs, PinSnapshot } from '../assemble'
import { briefingTextsFromMessages } from '../texts'

export const TEXTS = briefingTextsFromMessages(zhTW, 'zh-TW')
export const DAY = new Date(2026, 10, 21, 6, 0)
export const at = (day: number, h = 8) => new Date(2026, 10, day, h).getTime()

export function pinSnap(path: string, order: number, extra: Partial<EinkPin> = {}, content: string | null = `# ${path}\n\n${path} 的重點段落。`): PinSnapshot {
  return { pin: { path, pinnedAt: at(1), order, ...extra }, title: path.replace(/\.md$/, ''), content }
}

export function article(n: number, extra: Partial<ReadLaterItem> = {}): ReadLaterItem {
  return { url: `https://ex.com/${n}`, addedAt: at(n), status: 'pending', title: `文章 ${n}`, content: `正文 ${n}`, extractedAt: at(n, 9), ...extra }
}

/** 七個來源都有資料的一天。 */
export function fullInputs(): BriefingInputs {
  return {
    settings: { sections: [...BRIEFING_SECTIONS] },
    schedule: {
      status: 'ok',
      data: {
        calendar: 'granted',
        items: [
          { key: 'cal:b', kind: 'calendar', title: '看牙醫', start: at(21, 14), end: at(21, 15), allDay: false, source: '個人' },
          { key: 'task:a.md#寄報價', kind: 'task', title: '寄報價', start: at(21, 11), end: 0, allDay: false, source: 'a.md' },
          { key: 'cal:a', kind: 'calendar', title: '連假', start: at(21, 0), end: 0, allDay: true, source: '假日' },
        ],
      },
    },
    privateItems: ['cal:b'],
    weather: {
      status: 'ok',
      data: { location: '臺北市', parts: [{ part: 'morning', temperature: 14, precipitationProbability: 10, weatherCode: 1 }], high: 22, low: 10, precipitationProbability: 80, weatherCode: 61 },
    },
    pins: {
      status: 'ok',
      data: [
        pinSnap('舊.md', 1, { firstSentAt: at(10), lastSentAt: at(20) }),
        pinSnap('新.md', 0),
        pinSnap('不見了.md', 2, {}, null),
      ],
    },
    readLater: { status: 'ok', data: [article(5), article(3), article(4), article(2), article(1, { status: 'sent', sentAt: at(15) })] },
    report: {
      status: 'ok',
      data: { path: 'r.md', period: '2026-W47', generated: '2026-11-17T08:00', topics: [], suggestions: ['補連結'], stats: { notes: 1, unlinked: 0, orphans: 0, inbox: 0 } },
    },
    workbench: {
      status: 'ok',
      data: {
        decide: [{ key: 'b', title: '第二', when: '', at: 2 }, { key: 'a', title: '第一', when: '', at: 1 }],
        complete: [
          { path: 'a.md', line: 2, title: '今天', due: '2026-11-21', overdue: false },
          { path: 'a.md', line: 1, title: '逾期', due: '2026-11-19', overdue: true },
        ],
      },
    },
    log: { reviewShown: {} },
  }
}
