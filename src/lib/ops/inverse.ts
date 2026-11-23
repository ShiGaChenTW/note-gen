// Fork（almanac ALMNC-69.9）：每種操作的反向（純函式）。反向的反向等於原操作。
import type { OpSpec } from './types'

export function inverseOf(op: OpSpec): OpSpec {
  switch (op.kind) {
    case 'note.create': return { ...op, kind: 'note.delete' }
    case 'note.delete': return { ...op, kind: 'note.create' }
    case 'note.edit': return { ...op, before: op.after, after: op.before }
    case 'note.move': return { ...op, from: op.to, to: op.from }
    case 'moc.entry.add': return { ...op, kind: 'moc.entry.remove' }
    case 'moc.entry.remove': return { ...op, kind: 'moc.entry.add' }
    case 'moc.entry.move': {
      const { fromChapterId, toChapterId, ...rest } = op
      return {
        ...rest,
        ...(toChapterId !== undefined ? { fromChapterId: toChapterId } : {}),
        ...(fromChapterId !== undefined ? { toChapterId: fromChapterId } : {}),
      }
    }
    case 'domain.create': return { ...op, kind: 'domain.remove' }
    case 'domain.remove': return { ...op, kind: 'domain.create' }
  }
}

/** 一行說明（活動紀錄的 note 用；名稱優先，沒有才用路徑）。 */
export function describeOp(op: OpSpec): string {
  switch (op.kind) {
    case 'note.create':
    case 'note.delete':
    case 'note.edit':
    case 'note.move':
      return op.title
    case 'moc.entry.add':
    case 'moc.entry.remove':
    case 'moc.entry.move':
      return `${op.noteTitle} › ${op.mocName}`
    case 'domain.create':
    case 'domain.remove':
      return op.name
  }
}

/** 操作的主要對象檔案（活動紀錄的對象連結）。 */
export function targetPathOf(op: OpSpec): string {
  switch (op.kind) {
    case 'note.move': return op.to
    case 'moc.entry.add':
    case 'moc.entry.remove':
    case 'moc.entry.move':
      return op.mocPath
    default: return op.path
  }
}

/** 會動到 MOC 收錄的操作（套用或復原後要重建筆記的 domains）。 */
export function touchesMoc(op: OpSpec): boolean {
  return op.kind.startsWith('moc.') || op.kind.startsWith('domain.')
}
