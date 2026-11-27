// Fork（almanac ALMNC-88）：專家回顧領域時「建議你親手整理」的門檻與去重（純函式）。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FRAGMENT_THRESHOLD, FRAGMENT_COOLDOWN_DAYS, MIN_FRAGMENT_THRESHOLD, fragmentGroups, overlapsExisting, parseFragmentThreshold,
} from './fragments'

const notes = Array.from({ length: 10 }, (_, n) => ({ path: `notes/${n}.md` }))
const group = (indexes: number[], topic = '番茄鐘', reason = '五則都只有一兩句') => ({ topic, reason, notes: indexes })

describe('parseFragmentThreshold', () => {
  it('讀專家 rules.md 的「零散片段門檻：N」；沒寫、寫壞或太小時回傳 undefined（用預設）', () => {
    expect(parseFragmentThreshold('- 重新確認頻率：6 個月\n- 零散片段門檻：8 則')).toBe(8)
    expect(parseFragmentThreshold('fragment threshold: 6')).toBe(6)
    expect(parseFragmentThreshold('- 零散片段門檻:  4')).toBe(4)
    expect(parseFragmentThreshold('')).toBeUndefined()
    expect(parseFragmentThreshold(null)).toBeUndefined()
    expect(parseFragmentThreshold('- 零散片段門檻：很多')).toBeUndefined()
    expect(parseFragmentThreshold(`- 零散片段門檻：${MIN_FRAGMENT_THRESHOLD - 1}`)).toBeUndefined()
  })

  it('預設門檻是 5 則、冷卻 30 天', () => {
    expect(DEFAULT_FRAGMENT_THRESHOLD).toBe(5)
    expect(FRAGMENT_COOLDOWN_DAYS).toBe(30)
  })
})

describe('fragmentGroups：門檻', () => {
  it('同一主題片段數達門檻才產生；未達門檻的不產生', () => {
    const groups = fragmentGroups([group([0, 1, 2, 3, 4]), group([5, 6, 7, 8], '晨間例行')], notes, 5, [])
    expect(groups).toEqual([{ topic: '番茄鐘', reason: '五則都只有一兩句', paths: ['notes/0.md', 'notes/1.md', 'notes/2.md', 'notes/3.md', 'notes/4.md'] }])
  })

  it('門檻可調：門檻 4 時四則也算', () => {
    expect(fragmentGroups([group([5, 6, 7, 8], '晨間例行')], notes, 4, [])).toHaveLength(1)
  })

  it('不存在的索引、重複索引不算數（不會湊數過門檻）', () => {
    expect(fragmentGroups([group([0, 1, 1, 2, 99, -1])], notes, 4, [])).toEqual([])
    expect(fragmentGroups([group([0, 1, 1, 2, 3])], notes, 4, [])[0]?.paths).toHaveLength(4)
  })

  it('沒有主題名稱、或模型回的不是陣列時不產生', () => {
    expect(fragmentGroups([group([0, 1, 2, 3, 4], ' ')], notes, 5, [])).toEqual([])
    expect(fragmentGroups({ topic: 'x', notes: [0, 1, 2, 3, 4] }, notes, 5, [])).toEqual([])
    expect(fragmentGroups(undefined, notes, 5, [])).toEqual([])
  })
})

describe('fragmentGroups：去重', () => {
  it('同一群筆記已有未處理卡就不重複產生', () => {
    const existing = [{ paths: ['notes/0.md', 'notes/1.md', 'notes/2.md', 'notes/3.md', 'notes/4.md'] }]
    expect(fragmentGroups([group([0, 1, 2, 3, 4])], notes, 5, existing)).toEqual([])
  })

  it('大半重疊（一半以上已在某張卡裡）也算同一群', () => {
    const existing = [{ paths: ['notes/0.md', 'notes/1.md', 'notes/2.md'] }]
    expect(fragmentGroups([group([0, 1, 2, 3, 4])], notes, 5, existing)).toEqual([])
    expect(overlapsExisting(['notes/0.md', 'notes/1.md', 'notes/5.md', 'notes/6.md', 'notes/7.md'], existing)).toBe(false)
  })

  it('同一次回顧裡模型重複列同一群，只產生一張', () => {
    expect(fragmentGroups([group([0, 1, 2, 3, 4]), group([4, 3, 2, 1, 0], '番茄工作法')], notes, 5, [])).toHaveLength(1)
  })
})
