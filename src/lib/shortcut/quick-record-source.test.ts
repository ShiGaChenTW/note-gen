// almanac ALMNC-83.4：快速記錄文字在新介面存成資料源，走新增資料源（addNewSource）。
import { describe, expect, it, vi } from 'vitest'
import { createQuickSourceSaver, quickRecordTarget } from './quick-record-source'

describe('quickRecordTarget', () => {
  it('saves as a source in the new UI and as a record in classic', () => {
    expect(quickRecordTarget(true)).toBe('source')
    expect(quickRecordTarget(false)).toBe('record')
  })
})

describe('createQuickSourceSaver', () => {
  it('adds one text source through the new-source request', async () => {
    const add = vi.fn(async () => 'src:1')
    const save = createQuickSourceSaver(add)
    await expect(save({ id: 'a', text: '  明天要寄報價單  ', pastedChars: 0 })).resolves.toBe('src:1')
    expect(add).toHaveBeenCalledWith({ type: 'text', content: '明天要寄報價單', pastedChars: 0 })
  })

  it('passes pasted characters so mostly pasted text is judged as external capture', async () => {
    const add = vi.fn(async () => 'src:2')
    await createQuickSourceSaver(add)({ id: 'b', text: 'pasted text', pastedChars: 11 })
    expect(add).toHaveBeenCalledWith({ type: 'text', content: 'pasted text', pastedChars: 11 })
  })

  it('registers a retried request id only once', async () => {
    const add = vi.fn(async () => 'src:3')
    const save = createQuickSourceSaver(add)
    await save({ id: 'c', text: 'x' })
    await expect(save({ id: 'c', text: 'x' })).resolves.toBe('src:3')
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('lets a failed request be sent again', async () => {
    const add = vi.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce('src:4')
    const save = createQuickSourceSaver(add)
    await expect(save({ id: 'd', text: 'x' })).rejects.toThrow('db')
    await expect(save({ id: 'd', text: 'x' })).resolves.toBe('src:4')
    expect(add).toHaveBeenCalledTimes(2)
  })

  it('rejects empty text without adding a source', async () => {
    const add = vi.fn(async () => 'src:5')
    await expect(createQuickSourceSaver(add)({ id: 'e', text: '   ' })).rejects.toThrow('empty')
    expect(add).not.toHaveBeenCalled()
  })
})
