import { mocPageView } from '@/lib/domain-page/moc-view'
import type { NoteLike } from '@/lib/domain-page/model'
import type { ResolveTarget } from './membership'
import type { ParsedMoc } from './parse'
import { isSplitCountLine, splitCountLine, withSplitStatus } from './split-status'

/** 只更新系統狀態片段。凍結清單中的連結、順序、說明與其餘內文原樣保留。 */
export function refreshSplitDisplay(
  raw: string, moc: ParsedMoc, notes: ReadonlyMap<string, NoteLike>, resolve: ResolveTarget, mocs: readonly ParsedMoc[],
): string {
  if (!moc.chapters.some(chapter => chapter.grownInto)) return raw
  const view = mocPageView(moc, notes, resolve, mocs)
  const lines = raw.split(moc.eol)
  for (const [index, chapter] of [...moc.chapters.entries()].reverse()) {
    const panel = view.chapters[index]
    if (!chapter.grownInto || !panel.grownMocId) continue
    const child = mocs.find(item => item.id === panel.grownMocId)
    const entries = chapter.entries.filter(entry => !entry.duplicate)
    for (const [index, entry] of entries.entries()) {
      const row = panel.notes[index]
      const status = row.replacement ? `已由 [[${row.replacement.path.replace(/\.md$/i, '')}]] 取代`
        : row.status === 'superseded' ? '已被取代'
        : row.status === 'archived' ? '已封存'
        : row.outdated ? '過時'
        : (row.currentMocs ?? []).map(name => `\`${name.replace(/\x60/g, '')} MOC\``).join(' ')
      lines[entry.line] = withSplitStatus(lines[entry.line], status)
    }
    for (let line = chapter.endLine - 1; line > chapter.line; line--) {
      if (isSplitCountLine(lines[line])) lines.splice(line, 1)
    }
    if (panel.newSinceSplit && child?.path) {
      const afterEntries = ((entries.at(-1)?.line ?? chapter.commentLine) ?? chapter.line) + 1
      lines.splice(afterEntries, 0, splitCountLine(panel.newSinceSplit, child.path.replace(/\.md$/i, '')))
    }
  }
  return lines.join(moc.eol)
}
