import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '../messages/en.json'
import zh from '../messages/zh.json'
import zhTW from '../messages/zh-TW.json'
import commonZhTW from '../messages/common/zh-TW.json'

function findSavePath(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const rec = obj as Record<string, unknown>
  const upload = rec.imageUpload as Record<string, unknown> | undefined
  if (upload && typeof upload.savePath === 'string') return upload.savePath
  for (const v of Object.values(rec)) {
    const found = findSavePath(v)
    if (found) return found
  }
  return undefined
}

describe('ALMNC-66：繁中「設置」改「設定」', () => {
  it('common.settings 是「設定」', () => {
    expect(commonZhTW.settings).toBe('設定')
  })

  it('messages/ 底下的 zh-TW 檔不再出現「設置」', () => {
    const files = [join('messages', 'zh-TW.json'), ...readdirSync(join('messages', 'common')).filter(f => f.startsWith('zh-TW')).map(f => join('messages', 'common', f))]
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toContain('設置')
  })
})

describe('ALMNC-67：imageUpload.savePath 佔位符一致', () => {
  it.each([['en', en], ['zh', zh], ['zh-TW', zhTW]])('%s 用 {path}', (_name, messages) => {
    const savePath = findSavePath(messages)
    expect(savePath).toBeDefined()
    expect(savePath).toContain('{path}')
    expect(savePath).not.toContain('__PATH__')
  })
})
