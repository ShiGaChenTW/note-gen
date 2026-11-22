import { describe, expect, it, vi } from 'vitest'
import { DocumentParseError } from '@/lib/document-parser'
import { createFileTextReader, fileReasonKey, routeFile, type FileTextReaderDeps } from './file-route'
import { ConverterFailedError, ConverterUnavailableError } from './types'

function reader(overrides: Partial<FileTextReaderDeps> = {}) {
  const readText = vi.fn(async (path: string) => `text of ${path}`)
  const parseDocument = vi.fn(async (path: string, name: string) => ({ markdown: `# ${name}\nparsed ${path}` }))
  const read = createFileTextReader({ readText, parseDocument, reason: key => `REASON:${key}`, ...overrides })
  return { read, readText, parseDocument }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected rejection')
}

describe('routeFile', () => {
  it.each([
    ['/notes/a.md', 'text'],
    ['/notes/a.txt', 'text'],
    ['/notes/data.csv', 'text'],
    ['/notes/script.ts', 'text'],
    ['/Users/me/My Docs/report.pdf', 'document'],
    ['/x/proposal.DOCX', 'document'],
    ['/x/budget.xlsx', 'document'],
    ['/x/deck.pptx', 'document'],
    ['/x/old.doc', 'document'],
    ['/x/photo.heic', 'unsupported'],
    ['/x/archive.zip', 'unsupported'],
    ['/x/no-extension', 'unsupported'],
  ])('%s → %s', (ref, route) => {
    expect(routeFile(ref)).toBe(route)
  })
})

describe('createFileTextReader', () => {
  it('md／txt：直接讀文字，不解析', async () => {
    const { read, readText, parseDocument } = reader()
    await expect(read('/a/n.md')).resolves.toBe('text of /a/n.md')
    await expect(read('/a/n.txt')).resolves.toBe('text of /a/n.txt')
    expect(readText).toHaveBeenCalledTimes(2)
    expect(parseDocument).not.toHaveBeenCalled()
  })

  it.each(['report.pdf', 'memo.docx', 'sheet.xlsx', 'slides.pptx'])('%s：交給 anydoc 解析', async file => {
    const { read, readText, parseDocument } = reader()
    const text = await read(`/Users/me/My Files/${file}`)
    expect(parseDocument).toHaveBeenCalledWith(`/Users/me/My Files/${file}`, file)
    expect(readText).not.toHaveBeenCalled()
    expect(text).toContain(`# ${file}`)
  })

  it('不支援的格式：ConverterUnavailableError，帶 unsupported 原因', async () => {
    const { read, readText, parseDocument } = reader()
    const error = await caught(read('/x/photo.heic'))
    expect(error).toBeInstanceOf(ConverterUnavailableError)
    expect((error as ConverterUnavailableError).reason).toBe('REASON:unsupported')
    expect(readText).not.toHaveBeenCalled()
    expect(parseDocument).not.toHaveBeenCalled()
  })

  it('掃描 PDF（解析回報 SCANNED_PDF）：帶 scannedPdf 原因', async () => {
    const { read } = reader({ parseDocument: async () => { throw { code: 'SCANNED_PDF', message: 'no text layer' } } })
    const error = await caught(read('/x/scan.pdf'))
    expect(error).toBeInstanceOf(ConverterFailedError)
    expect((error as ConverterFailedError).reason).toBe('REASON:scannedPdf')
    expect((error as Error).message).toContain('SCANNED_PDF')
  })

  it('加密檔：帶 encrypted 原因', async () => {
    const { read } = reader({ parseDocument: async () => { throw new DocumentParseError('ENCRYPTED', 'password') } })
    expect(((await caught(read('/x/secret.docx'))) as ConverterFailedError).reason).toBe('REASON:encrypted')
  })

  it('解析成功但沒有文字：PDF 當成掃描檔，其他格式說沒有文字', async () => {
    const { read } = reader({ parseDocument: async () => ({ markdown: '  \n ' }) })
    expect(((await caught(read('/x/blank.pdf'))) as ConverterFailedError).reason).toBe('REASON:scannedPdf')
    expect(((await caught(read('/x/blank.pptx'))) as ConverterFailedError).reason).toBe('REASON:noText')
  })

  it('文字檔讀不到：帶 readFailed 原因', async () => {
    const { read } = reader({ readText: async () => { throw new Error('ENOENT') } })
    const error = await caught(read('/x/gone.md'))
    expect(error).toBeInstanceOf(ConverterFailedError)
    expect((error as ConverterFailedError).reason).toBe('REASON:readFailed')
  })
})

describe('fileReasonKey', () => {
  it.each([
    [new DocumentParseError('SCANNED_PDF', ''), 'scannedPdf'],
    [new DocumentParseError('ENCRYPTED', ''), 'encrypted'],
    [{ code: 'MALFORMED', message: 'x' }, 'malformed'],
    [{ code: 'MISSING_PART', message: 'x' }, 'malformed'],
    [{ code: 'RESOURCE_LIMIT' }, 'resourceLimit'],
    [{ code: 'FILE_TOO_LARGE' }, 'fileTooLarge'],
    [{ code: 'READ_FAILED' }, 'readFailed'],
    [{ code: 'UNSUPPORTED' }, 'unsupported'],
    [{ code: 'PARSE_FAILED' }, 'parseFailed'],
    [new Error('panic in parser'), 'parseFailed'],
    ['weird string', 'parseFailed'],
  ])('%o → %s', (error, key) => {
    expect(fileReasonKey(error)).toBe(key)
  })
})
