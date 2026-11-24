// 系統產生的分家現況片段。留在 Markdown 中供 Obsidian 閱讀，復原版本只比對人工內容。
const STATUS = ' <!-- moc-split-status -->'
const COUNT = '<!-- moc-split-count -->'
// 系統接手前手寫的舊格式：行尾一或多個 `X MOC` 標籤，以及「- 分家後新增的 N 則…」說明行。
const LEGACY_MARKERS = /(?:\s*`[^`\n]+?\s+MOC`)+\s*$/
const LEGACY_COUNT = /^[-*+]\s+分家後新增的\s*\d+\s*則/

export function withSplitStatus(line: string, status: string): string {
  // 舊標籤一律由系統接手：筆記已不在任何 MOC 時（status 為空）也要拿掉過時的手寫標籤。
  const original = stripSplitEntryStatus(line).replace(LEGACY_MARKERS, '')
  return status ? original + STATUS + ' ' + status : original
}

export function stripSplitEntryStatus(line: string): string {
  const at = line.indexOf(STATUS)
  return at === -1 ? line : line.slice(0, at)
}

export function splitCountLine(count: number, destination: string): string {
  return `${COUNT}分家後新增的 ${count} 則不列在這裡，見 [[${destination}]]。`
}

export function isSplitCountLine(line: string): boolean {
  return line.startsWith(COUNT)
}

/** 手寫的舊說明行。系統寫入自己的 count 行時一併移除，不並存兩行。 */
export function isLegacySplitCountLine(line: string): boolean {
  return LEGACY_COUNT.test(line)
}

export function withoutSplitStatus(content: string): string {
  if (!content.includes(STATUS) && !content.includes(COUNT)) return content
  return content.split('\n').filter(line => !isSplitCountLine(line)).map(stripSplitEntryStatus).join('\n')
}
