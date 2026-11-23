// Fork（almanac ALMNC-69.9）：檔案快照與版本比對的共用模組（從 ALMNC-17 自動整理 organize_undo 抽出來）。
// - 快照比對（snapshotMismatch）：organize 的交易照舊用「整份內容相等」判斷（套用前＝before、復原前＝after）。
// - 內容版本（contentVersion）：ops 只存雜湊（base_versions），復原前比對目前檔案；
//   筆記 frontmatter 的 domains 由 MOC 正式收錄重建（系統自己會改），不算「後續變更」，算版本時拿掉。
import { findFrontmatterEnd } from '@/lib/markdown/frontmatter-split'

/** 一個檔案的前後快照；null＝檔案不存在（新建前、刪除後）。 */
export interface FileSnapshot {
  path: string
  before: string | null
  after: string | null
}

export type SnapshotDirection = 'apply' | 'undo' | 'recover'

/**
 * 找出目前內容和快照對不上的檔案：apply 要等於 before、undo 要等於 after、recover（中途中斷）兩者之一。
 * 回傳對不上的路徑（空陣列＝全部對得上）。
 */
export async function snapshotMismatch(
  changes: readonly FileSnapshot[],
  read: (path: string) => Promise<string | null>,
  direction: SnapshotDirection,
): Promise<string[]> {
  const mismatched: string[] = []
  for (const { path, before, after } of changes) {
    const current = await read(path)
    if (direction === 'apply' && current === before) continue
    if (direction === 'undo' && current === after) continue
    if (direction === 'recover' && (current === before || current === after)) continue
    mismatched.push(path)
  }
  return mismatched
}

const DOMAINS_KEY = /^domains\s*:/
const CONTINUATION = /^(\s+\S|\s*-\s)/

/** 拿掉 frontmatter 的 domains 欄位（含底下的清單行）；沒有 frontmatter 原樣回傳。 */
export function withoutDerivedFields(content: string): string {
  const end = findFrontmatterEnd(content)
  if (end === null) return content
  const lines = content.slice(0, end).split(/\r?\n/)
  const kept: string[] = []
  let skipping = false
  for (const line of lines) {
    if (DOMAINS_KEY.test(line)) {
      skipping = true
      continue
    }
    if (skipping && CONTINUATION.test(line)) continue
    skipping = false
    kept.push(line)
  }
  return `${kept.join('\n')}${content.slice(end)}`
}

/** 53 位元雜湊（cyrb53），十六進位。只拿來比對版本，不是安全用途。 */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** 檔案內容的版本；檔案不存在是 null。換行統一成 \n 後再算，domains 不算。 */
export function contentVersion(content: string | null): string | null {
  if (content === null) return null
  return hashText(withoutDerivedFields(content.replace(/\r\n/g, '\n')))
}

/** 目前內容和記下的版本相同嗎。 */
export function sameVersion(current: string | null, version: string | null): boolean {
  return contentVersion(current) === version
}
