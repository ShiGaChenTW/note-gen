// Fork（almanac ALMNC-54.16）：V3 文件標題欄位用的純函式。「標題」就是檔名去掉 .md，改標題等於改檔名；不在內文插入 H1。

/** 新文件的預設檔名（不含 .md）。上游的 Untitled 沒有在地化，這裡固定用「未命名」。 */
export const UNTITLED_BASE = '未命名'

/** 檔名不能用的字元（含各平台都擋的 \ / : * ? " < > | 與控制字元），一律換成「-」。 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g

/** 只有 .md 檔才顯示標題欄位，改名時才能放心沿用 .md。 */
export function isMarkdownDocPath(path: string): boolean {
  return /\.md$/i.test(path)
}

/** 路徑的檔名去掉 .md，就是標題欄位顯示的文字。 */
export function titleFromPath(path: string): string {
  const name = path.split('/').pop() ?? ''
  return name.replace(/\.md$/i, '')
}

/** 路徑所在的資料夾（相對工作區），根目錄是空字串。 */
export function parentFolderOf(path: string): string {
  return path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
}

/**
 * 把使用者輸入的標題整理成可用的檔名（不含 .md）：非法字元換成「-」、去掉前後空白、
 * 使用者自己打的 .md、開頭的點（避免變成隱藏檔）與結尾的點和空白。整理完是空字串代表沒有可用的名字。
 */
export function sanitizeDocTitle(input: string): string {
  return input
    .replace(ILLEGAL_FILENAME_CHARS, '-')
    .trim()
    .replace(/\.md$/i, '')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
}

/** 標題送出時要不要改名：空白或和現在一樣就不改（回傳 null），否則回傳目標資料夾與檔名。 */
export function planTitleCommit(path: string, input: string): { parent: string, base: string } | null {
  const base = sanitizeDocTitle(input)
  if (!base || base === titleFromPath(path)) return null
  return { parent: parentFolderOf(path), base }
}
