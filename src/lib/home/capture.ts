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

export function capturePath(folder: string, fileName: string, attempt = 0): string {
  const clean = folder.replace(/^\/+|\/+$/g, '')
  const name = attempt === 0 ? fileName : fileName.replace(/\.md$/, ` ${attempt + 1}.md`)
  return clean ? `${clean}/${name}` : name
}

export function captureContent(text: string): string {
  return `${text.trim()}\n`
}
