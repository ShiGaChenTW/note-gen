// Fork（#32）：快速記錄存成 Inbox 裡的一則新筆記。

const ILLEGAL = /[\\/:*?"<>|#^[\]\n\r\t]+/g

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** 檔名：YYYY-MM-DD HHmm <前 24 字>.md；同名時呼叫端加序號。 */
export function captureFileName(text: string, now: Date): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`
  const firstLine = text.trim().split('\n')[0] ?? ''
  const title = Array.from(firstLine.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim()).slice(0, 24).join('').trim()
  return title ? `${stamp} ${title}.md` : `${stamp}.md`
}

// Fork（almanac ALMNC-69.1）：接受的筆記提案檔名就是標題（不再加時間前綴）；同名時呼叫端用 capturePath 加序號。
// 只去掉檔名不能用的字元；過長時截到 NOTE_FILE_NAME_MAX 字（中文一字 3 bytes，留在 255 bytes 檔名上限內）。
export const NOTE_FILE_NAME_MAX = 80

/** 檔名：<標題>.md；標題清完是空的就退回 captureFileName 的時間格式。 */
export function noteFileName(title: string, now: Date): string {
  const firstLine = title.trim().split('\n')[0] ?? ''
  const clean = Array.from(firstLine.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim()).slice(0, NOTE_FILE_NAME_MAX).join('').trim()
  // 開頭的 . 會變成隱藏檔，拿掉。
  const name = clean.replace(/^\.+/, '').trim()
  return name ? `${name}.md` : captureFileName('', now)
}

export function capturePath(folder: string, fileName: string, attempt = 0): string {
  const clean = folder.replace(/^\/+|\/+$/g, '')
  const name = attempt === 0 ? fileName : fileName.replace(/\.md$/, ` ${attempt + 1}.md`)
  return clean ? `${clean}/${name}` : name
}

export function captureContent(text: string): string {
  return `${text.trim()}\n`
}
