// Fork（almanac ALMNC-69.3）：從新增資料源對話框開的文件，「完成」記錄跟著改名走。
import { describe, expect, it } from 'vitest'
import { renamePendingPaths, usePendingDoneStore } from './pending-done'

describe('pending-done', () => {
  it('renamePendingPaths：檔案改名、所在資料夾改名都跟著走；無關的不動', () => {
    const pending = { '未命名.md': { journal: true }, 'a/b.md': { journal: false } }
    expect(renamePendingPaths(pending, '未命名.md', '下午被打斷.md')).toEqual({ '下午被打斷.md': { journal: true }, 'a/b.md': { journal: false } })
    expect(renamePendingPaths(pending, 'a', 'c')).toEqual({ '未命名.md': { journal: true }, 'c/b.md': { journal: false } })
    expect(renamePendingPaths(pending, 'ab', 'x')).toBe(pending)
  })

  it('store：記下、改名、按完成後清掉', () => {
    const store = usePendingDoneStore.getState()
    store.mark('未命名.md', { journal: true })
    usePendingDoneStore.getState().rename('未命名.md', '日誌/今天.md')
    expect(usePendingDoneStore.getState().pending).toEqual({ '日誌/今天.md': { journal: true } })
    usePendingDoneStore.getState().clear('日誌/今天.md')
    expect(usePendingDoneStore.getState().pending).toEqual({})
  })
})
