// Fork（almanac ALMNC-52）：一鍵安裝與立即推送。
//   planInstall／planPush  純函式：列出這次會在電子紙上建哪些資料夾、寫哪些檔、加哪個 OPDS 書目（有單元測試）
//   runPlan                先用白名單檢查整份計畫（有一項不合就整份不做、不發請求），再依序執行
//   installToReader        外掛檔（含伺服器網址與 token）＋可選的中文字型＋OPDS 書目
//   pushNow                上傳今日簡報與休眠畫面，兩個都確認寫好後才 commitSent（ALMNC-47）
import type { Briefing } from '@/lib/eink/briefing/types'
import {
  BRIEFING_DIR, FONT_ROOT, OPDS_ENTRY_NAME, PLUGIN_ROOT, PUSHED_BRIEFINGS_KEEP, SLEEP_DEST,
} from '@/lib/eink/crosspoint'
import { LAN_OPDS_USER, lanOpdsUrl } from '@/lib/eink/lan/urls'
import { renderPluginFiles, type PluginTemplates } from '@/lib/eink/plugin/files'
import { CrossPointClient, type HttpFn, type OpdsInput } from './client'
import { DevicePathError, isAllowedDir, isAllowedFile, isValidFontFileName, type AllowOptions } from './paths'

export type DeviceOp =
  | { kind: 'mkdir', path: string }
  | { kind: 'upload', path: string, bytes: Uint8Array, contentType: string, skipIfSameSize?: boolean }
  | { kind: 'opds', entry: OpdsInput }

export interface FontFile {
  name: string
  bytes: Uint8Array
}

export interface InstallOptions {
  /** 區網服務網址，例如 http://192.168.1.5:37424 */
  server: string
  token: string
  includeBriefing?: boolean
  font?: FontFile | null
}

const encoder = new TextEncoder()

function contentTypeFor(path: string): string {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (path.endsWith('.epub')) return 'application/epub+zip'
  if (path.endsWith('.bmp')) return 'image/bmp'
  if (path.endsWith('.ttf')) return 'font/ttf'
  if (path.endsWith('.otf')) return 'font/otf'
  return 'application/octet-stream'
}

export function allowOptionsFor(ops: readonly DeviceOp[]): AllowOptions {
  return {
    fontFiles: ops.flatMap(op => op.kind === 'upload' && op.path.startsWith(`${FONT_ROOT}/`) ? [op.path.slice(FONT_ROOT.length + 1)] : []),
  }
}

/** 一鍵安裝會做的事（照順序）。 */
export function planInstall(templates: PluginTemplates, options: InstallOptions): DeviceOp[] {
  const files = renderPluginFiles(templates, { server: options.server, token: options.token, includeBriefing: options.includeBriefing })
  const ops: DeviceOp[] = [{ kind: 'mkdir', path: PLUGIN_ROOT }]
  const dirs = [...new Set(files.map(file => file.path.slice(0, file.path.lastIndexOf('/'))))]
  for (const dir of dirs) ops.push({ kind: 'mkdir', path: dir })
  for (const file of files) ops.push({ kind: 'upload', path: file.path, bytes: encoder.encode(file.content), contentType: contentTypeFor(file.path) })
  if (options.includeBriefing) ops.push({ kind: 'mkdir', path: BRIEFING_DIR })
  if (options.font) {
    if (!isValidFontFileName(options.font.name)) throw new DevicePathError(`invalid font file name: ${options.font.name}`)
    ops.push({ kind: 'mkdir', path: FONT_ROOT })
    ops.push({
      kind: 'upload', path: `${FONT_ROOT}/${options.font.name}`, bytes: options.font.bytes, contentType: contentTypeFor(options.font.name), skipIfSameSize: true,
    })
  }
  ops.push({ kind: 'opds', entry: { name: OPDS_ENTRY_NAME, url: lanOpdsUrl(options.server.replace(/\/+$/, '')), username: LAN_OPDS_USER, password: options.token } })
  return ops
}

export interface PushContent {
  date: string
  epub: Uint8Array
  sleep: Uint8Array
}

export function pushedEpubName(date: string): string {
  return `almanac-${date}.epub`
}

/** 立即推送會做的事：今日簡報放進 /Books/Almanac/、休眠畫面寫到 /sleep.bmp。 */
export function planPush(content: PushContent): DeviceOp[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(content.date)) throw new DevicePathError(`invalid date: ${content.date}`)
  return [
    { kind: 'mkdir', path: '/Books' },
    { kind: 'mkdir', path: BRIEFING_DIR },
    { kind: 'upload', path: `${BRIEFING_DIR}/${pushedEpubName(content.date)}`, bytes: content.epub, contentType: 'application/epub+zip' },
    { kind: 'upload', path: SLEEP_DEST, bytes: content.sleep, contentType: 'image/bmp' },
  ]
}

/** 整份計畫的白名單檢查；回傳不合的路徑（空陣列＝可以做）。 */
export function disallowedPaths(ops: readonly DeviceOp[]): string[] {
  const allow = allowOptionsFor(ops)
  return ops.flatMap(op => {
    if (op.kind === 'mkdir') return isAllowedDir(op.path) ? [] : [op.path]
    if (op.kind === 'upload') return isAllowedFile(op.path, allow) ? [] : [op.path]
    return []
  })
}

export interface RunReport {
  written: string[]
  skipped: string[]
  opds: 'added' | 'updated' | null
}

export async function runPlan(http: HttpFn, readerBase: string, ops: readonly DeviceOp[], onStep?: (index: number, op: DeviceOp) => void): Promise<RunReport> {
  const bad = disallowedPaths(ops)
  if (bad.length > 0) throw new DevicePathError(`not allowed on the reader: ${bad.join(', ')}`)
  const client = new CrossPointClient(http, readerBase, allowOptionsFor(ops))
  const report: RunReport = { written: [], skipped: [], opds: null }
  for (const [index, op] of ops.entries()) {
    onStep?.(index, op)
    if (op.kind === 'mkdir') {
      await client.ensureDir(op.path)
    } else if (op.kind === 'upload') {
      if (op.skipIfSameSize) {
        const dir = op.path.slice(0, op.path.lastIndexOf('/')) || '/'
        const name = op.path.slice(op.path.lastIndexOf('/') + 1)
        const existing = (await client.listFiles(dir)).find(entry => !entry.isDirectory && entry.name === name)
        if (existing && existing.size === op.bytes.length) {
          report.skipped.push(op.path)
          continue
        }
      }
      await client.uploadVerified(op.path, op.bytes, op.contentType)
      report.written.push(op.path)
    } else {
      report.opds = await client.ensureOpds(op.entry)
    }
  }
  return report
}

export async function installToReader(http: HttpFn, readerBase: string, templates: PluginTemplates, options: InstallOptions): Promise<RunReport> {
  return runPlan(http, readerBase, planInstall(templates, options))
}

/** 立即推送；兩個檔都確認寫好才呼叫 commit（給 commitSent），中途失敗不 commit。之後清掉書庫裡太舊的推送。 */
export async function pushNow(
  http: HttpFn,
  readerBase: string,
  content: PushContent & { briefing: Briefing },
  commit: (briefing: Briefing) => Promise<void>,
): Promise<RunReport> {
  const report = await runPlan(http, readerBase, planPush(content))
  await commit(content.briefing)
  await prunePushedBriefings(new CrossPointClient(http, readerBase), PUSHED_BRIEFINGS_KEEP).catch(() => {})
  return report
}

/** 只刪 /Books/Almanac/ 裡 almanac-YYYY-MM-DD.epub 形式的舊檔，保留最新 keep 本。 */
export async function prunePushedBriefings(client: CrossPointClient, keep: number): Promise<string[]> {
  const dated = (await client.listFiles(BRIEFING_DIR))
    .filter(entry => !entry.isDirectory && /^almanac-\d{4}-\d{2}-\d{2}\.epub$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
  const old = dated.slice(0, Math.max(0, dated.length - keep))
  for (const name of old) await client.delete(`${BRIEFING_DIR}/${name}`)
  return old
}

/** 偵測：只有使用者按下「偵測閱讀器」才呼叫（AC #4：沒開偵測不發任何區網請求）。 */
export async function detectReader(http: HttpFn, readerBase: string) {
  return new CrossPointClient(http, readerBase, {}, 4000).status()
}
