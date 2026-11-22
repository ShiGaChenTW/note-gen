import { describe, expect, it, vi } from 'vitest'
import { createSource, type Source } from '@/lib/v3-model/source'
import { looksLikeRef, MAX_ANALYSIS_TEXT, toText } from './to-text'
import { ConverterUnavailableError } from './types'

const T0 = Date.UTC(2026, 10, 21)
function source(partial: Partial<Source> & Pick<Source, 'kind' | 'content'>): Source {
  return { ...createSource({ id: 's1', sourceType: 'self', kind: partial.kind, content: partial.content, collector: 'scott' }, T0), ...partial }
}

describe('toText', () => {
  it('文字資料源不需要轉換，也不呼叫任何轉換器', async () => {
    const converters = { ocrImage: vi.fn(), fetchWeb: vi.fn(), transcribe: vi.fn(), readFileText: vi.fn() }
    const result = await toText(source({ kind: 'text', content: '  今天和 Amy 開會  ' }), converters)
    expect(result).toEqual({ text: '今天和 Amy 開會', converter: 'none', status: 'text' })
    for (const fn of Object.values(converters)) expect(fn).not.toHaveBeenCalled()
  })

  it('網頁抓全文，記下用了 web 轉換器', async () => {
    const fetchWeb = vi.fn(async () => '# 標題\n全文')
    const result = await toText(source({ kind: 'link', content: 'https://example.com/a' }), { fetchWeb })
    expect(fetchWeb).toHaveBeenCalledWith('https://example.com/a')
    expect(result.converter).toBe('web')
    expect(result.status).toBe('converted')
    expect(result.text).toContain('全文')
    expect(result.text).toContain('https://example.com/a')
  })

  it('截圖辨識文字；使用者的說明放在前面', async () => {
    const ocrImage = vi.fn(async () => 'OCR 文字')
    const result = await toText(source({ kind: 'image', content: '白板照片', origin: '/tmp/board.png' }), { ocrImage })
    expect(ocrImage).toHaveBeenCalledWith('/tmp/board.png')
    expect(result).toMatchObject({ converter: 'ocr', status: 'converted', text: '白板照片\n\nOCR 文字' })
  })

  it('會議錄音轉逐字稿', async () => {
    const transcribe = vi.fn(async () => '逐字稿內容')
    const result = await toText(source({ kind: 'voice', content: '/rec/meeting.m4a' }), { transcribe })
    expect(result).toMatchObject({ converter: 'transcription', status: 'converted', text: '逐字稿內容' })
  })

  it('語音內容已經是文字（錄音時已轉好）就直接用', async () => {
    const transcribe = vi.fn()
    const result = await toText(source({ kind: 'voice', content: '提醒我明天買牛奶' }), { transcribe })
    expect(transcribe).not.toHaveBeenCalled()
    expect(result).toMatchObject({ converter: 'none', status: 'text', text: '提醒我明天買牛奶' })
  })

  it('轉換器沒設定：保留原始內容並標成 unavailable', async () => {
    const result = await toText(source({ kind: 'image', content: '/tmp/shot.png' }), {})
    expect(result).toMatchObject({ converter: 'ocr', status: 'unavailable', text: '/tmp/shot.png' })
  })

  it('轉換器回報沒設定（ConverterUnavailableError）也是 unavailable；其他錯誤是 failed', async () => {
    const unavailable = await toText(source({ kind: 'image', content: '/a.png' }), { ocrImage: async () => { throw new ConverterUnavailableError('no OCR') } })
    expect(unavailable).toMatchObject({ status: 'unavailable', note: 'no OCR', text: '/a.png' })
    const failed = await toText(source({ kind: 'image', content: '/a.png' }), { ocrImage: async () => { throw new Error('boom') } })
    expect(failed).toMatchObject({ status: 'failed', note: 'boom', text: '/a.png' })
    const empty = await toText(source({ kind: 'image', content: '/a.png' }), { ocrImage: async () => '   ' })
    expect(empty.status).toBe('failed')
  })

  it('data URL 這種二進位內容不會被當成文字送出，退回來處', async () => {
    const result = await toText(source({ kind: 'image', content: 'data:image/png;base64,AAAA', origin: 'screenshot.png' }), {})
    expect(result.status).toBe('unavailable')
    expect(result.text).toBe('screenshot.png')
  })

  it('檔案讀不了（例如 PDF 沒有轉換器）就保留原檔', async () => {
    const readFileText = vi.fn(async () => { throw new ConverterUnavailableError('unsupported') })
    const result = await toText(source({ kind: 'file', content: '/docs/spec.pdf' }), { readFileText })
    expect(result).toMatchObject({ converter: 'file', status: 'unavailable', text: '/docs/spec.pdf' })
  })

  it('RSS 文章：摘要在前、抓文章全文在後；抓不到就用存下來的摘要', async () => {
    const content = '標題\n\n連結：https://ie.example.com/posts/5s\n\n摘要'
    const fetchWeb = vi.fn(async () => '全文')
    const ok = await toText(source({ kind: 'rss', content, origin: 'https://ie.example.com/posts/5s' }), { fetchWeb })
    expect(fetchWeb).toHaveBeenCalledWith('https://ie.example.com/posts/5s')
    expect(ok).toMatchObject({ converter: 'web', status: 'converted', text: `${content}\n\n全文` })
    const failed = await toText(source({ kind: 'rss', content, origin: 'https://ie.example.com/posts/5s' }), { fetchWeb: async () => { throw new Error('blocked') } })
    expect(failed).toMatchObject({ converter: 'web', status: 'failed', text: content })
  })

  it('太長的文字截短並註明', async () => {
    const result = await toText(source({ kind: 'text', content: '字'.repeat(MAX_ANALYSIS_TEXT + 10) }), {})
    expect(Array.from(result.text)).toHaveLength(MAX_ANALYSIS_TEXT)
    expect(result.note).toContain('truncated')
  })
})

describe('looksLikeRef', () => {
  it.each([
    ['/Users/me/My File.png', true],
    ['photo.jpg', true],
    ['https://a.b/c', true],
    ['data:image/png;base64,AA', true],
    ['今天的會議很有收穫', false],
    ['see v1.2 notes', false],
    ['兩行\n/tmp/a.png', false],
  ])('%s → %s', (value, expected) => {
    expect(looksLikeRef(value)).toBe(expected)
  })
})
