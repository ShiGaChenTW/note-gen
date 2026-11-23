// 系統產生的分家現況片段。留在 Markdown 中供 Obsidian 閱讀，復原版本只比對人工內容。
const STATUS = ' <!-- moc-split-status -->'
const COUNT = '<!-- moc-split-count -->'

export function withSplitStatus(line: string, status: string): string {
  const original = stripSplitEntryStatus(line)
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

export function withoutSplitStatus(content: string): string {
  if (!content.includes(STATUS) && !content.includes(COUNT)) return content
  return content.split('\n').filter(line => !isSplitCountLine(line)).map(stripSplitEntryStatus).join('\n')
}
