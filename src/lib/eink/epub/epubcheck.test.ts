// almanac ALMNC-48 AC #1：epubcheck 沒有錯誤。
// 需要本機裝好 epubcheck（brew install epubcheck），預設跳過；要跑時：
//   RUN_EPUBCHECK=1 npx vitest run src/lib/eink/epub/epubcheck.test.ts
// EPUBCHECK_OUT=<資料夾> 可以把產生的樣本留下來（預設寫到系統暫存資料夾）。
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DAY_PARTS, EPUB_TEXTS, GENERATED_AT, IMAGE_URLS, heavyBriefing, sampleBriefing, tinyImages } from './__fixtures__/briefing'
import { fitBriefingEpub } from './index'
import { EPUB_MAX_BYTES } from './params'

const run = process.env.RUN_EPUBCHECK === '1'
const options = { texts: EPUB_TEXTS, locale: 'zh-TW', dayParts: DAY_PARTS, generatedAt: GENERATED_AT }

interface EpubcheckReport {
  checker: { nFatal: number, nError: number, nWarning: number }
  messages: Array<{ ID: string, severity: string, message: string, locations: Array<{ path: string, line: number }> }>
}

function epubcheck(file: string): EpubcheckReport {
  const out = `${file}.epubcheck.json`
  try {
    execFileSync('epubcheck', [file, '--json', out], { stdio: 'pipe' })
  } catch {
    // 有錯誤時 epubcheck 回非 0，報告照樣寫出來
  }
  return JSON.parse(readFileSync(out, 'utf8')) as EpubcheckReport
}

function problems(report: EpubcheckReport): string[] {
  return report.messages
    .filter(m => m.severity === 'ERROR' || m.severity === 'FATAL')
    .map(m => `${m.ID} ${m.message} @ ${m.locations.map(l => `${l.path}:${l.line}`).join(', ')}`)
}

describe.skipIf(!run)('epubcheck（AC #1）', () => {
  const dir = process.env.EPUBCHECK_OUT ?? mkdtempSync(path.join(tmpdir(), 'almanac-epubcheck-'))
  mkdirSync(dir, { recursive: true })

  const cases = {
    // 中文、圖片、wikilink 內部連結、附錄、續讀見附錄
    normal: () => fitBriefingEpub(sampleBriefing(), tinyImages(IMAGE_URLS), options),
    // 超過 1 MB → 砍最早那篇的附錄全文
    oversize: () => { const { briefing, images } = heavyBriefing(); return fitBriefingEpub(briefing, images, options) },
    // 每一步都做（回顧卡 1 張、知識報告一句話、圖片拿掉…）
    trimmedAll: () => { const { briefing, images } = heavyBriefing(); return fitBriefingEpub(briefing, images, { ...options, maxBytes: 1 }) },
  }

  for (const [name, build] of Object.entries(cases)) {
    it(`${name}：沒有錯誤`, () => {
      const epub = build()
      const file = path.join(dir, `almanac-2026-11-21-${name}.epub`)
      writeFileSync(file, epub.bytes)
      const report = epubcheck(file)
      console.info(`[epubcheck] ${name}: ${epub.bytes.length} bytes, fatal ${report.checker.nFatal}, error ${report.checker.nError}, warning ${report.checker.nWarning} → ${file}`)
      expect(problems(report)).toEqual([])
      if (name === 'oversize') expect(epub.bytes.length).toBeLessThanOrEqual(EPUB_MAX_BYTES)
    }, 60_000)
  }
})
