// Fork（almanac ALMNC-54.8）：檯面（專注模式）——素材、工作稿、協助三欄。
// 檯面上的結構操作直接生效，不走提案（第四節「檯面上的整理直接生效」）：搬移、加標籤、連結、合併筆記、歸入領域。
// 寫檔由 actions.ts 提供 Tauri I/O。
// Fork（almanac ALMNC-69.7）：「歸入領域」不再直接改筆記 frontmatter 的 domains，而是把收錄行寫進該領域 MOC 的「尚未分章」，
// 再由重建（lib/moc）更新 domains——MOC 上的正式收錄是唯一依據。
import { archiveMergedNote } from '@/lib/cleanup/plan'
import { parseV3Note, writeV3NoteFields, createV3Note } from '@/lib/v3-model/note'

export type DeskMaterialKind = 'note' | 'source' | 'record' | 'capture'

export interface DeskMaterial {
  /** 素材的唯一鍵（筆記用路徑，其他用清單列 id）。 */
  id: string
  kind: DeskMaterialKind
  title: string
  text: string
  /** 筆記在筆記庫的相對路徑；只有筆記能做結構操作。 */
  path?: string
  /** 資料源 id（存成筆記時寫進 sources 欄位）。 */
  sourceId?: string
  /** 已讀取的筆記原文（包含 frontmatter），供合併寫入前比對。 */
  noteRaw?: string
}

export type StructuralOp =
  | { op: 'move', path: string, folder: string }
  | { op: 'tag', path: string, tag: string }
  | { op: 'link', path: string, target: string }
  | { op: 'assignDomain', path: string, domainId: string }

/** 作用在單一素材上的結構操作。合併在頁首套用整份工作稿。 */
export const STRUCTURAL_OPS = ['move', 'tag', 'link', 'assignDomain'] as const

export interface NoteIo {
  read: (path: string) => Promise<string | null>
  write: (path: string, content: string) => Promise<void>
  /** 搬到資料夾，回傳新路徑。 */
  move: (path: string, folder: string) => Promise<string>
  /** Fork（almanac ALMNC-69.7）：把筆記收進領域的 MOC（尚未分章）並重建 domains；回傳復原（沒有改到就是 undefined）。 */
  assignDomain: (path: string, domainId: string) => Promise<(() => Promise<void>) | undefined>
}

function cleanTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/\s+/g, '-')
}

function wikiTarget(path: string): string {
  return path.replace(/\.md$/i, '')
}

/** 執行一個結構操作，回傳操作後筆記的路徑（搬移會改路徑）與能復原的寫入。 */
export async function applyStructuralOp(op: StructuralOp, io: NoteIo): Promise<{ path?: string, undo?: () => Promise<void> }> {
  if (op.op === 'move') {
    const folder = op.folder.trim().replace(/^\/+|\/+$/g, '')
    const from = op.path
    const to = await io.move(from, folder)
    const back = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
    return { path: to, undo: async () => { await io.move(to, back) } }
  }
  if (op.op === 'assignDomain') {
    const undo = await io.assignDomain(op.path, op.domainId)
    return undo ? { path: op.path, undo } : { path: op.path }
  }
  const raw = await io.read(op.path)
  if (raw === null) throw new Error(`note not found: ${op.path}`)
  const { fields } = parseV3Note(raw)
  let next = raw
  if (op.op === 'tag') {
    const tag = cleanTag(op.tag)
    if (!tag || fields.tags.includes(tag)) return { path: op.path }
    next = writeV3NoteFields(raw, { tags: [...fields.tags, tag] })
  } else if (op.op === 'link') {
    const target = `[[${wikiTarget(op.target)}]]`
    if (op.target === op.path || fields.related.includes(target)) return { path: op.path }
    next = writeV3NoteFields(raw, { related: [...fields.related, target] })
  }
  await io.write(op.path, next)
  return { path: op.path, undo: async () => { await io.write(op.path, raw) } }
}

/** 檯面標題：「產線平衡 等 5 則」。 */
export function deskHeading(materials: readonly DeskMaterial[]): { first: string, more: number } {
  return { first: materials[0]?.title ?? '', more: Math.max(0, materials.length - 1) }
}

/** 工作稿的起始內容：把素材依序列出，Scott 再改寫（指揮官的草稿要等協助欄的處理對話）。 */
export function initialDraft(materials: readonly DeskMaterial[]): { title: string, body: string } {
  return {
    title: materials[0]?.title ?? '',
    body: materials.filter(material => material.text.trim()).map(material => `## ${material.title}\n\n${material.text.trim()}`).join('\n\n'),
  }
}

/** 工作稿存成筆記：標上「親手寫的」，來源資料源記進 sources，素材筆記記進 related。 */
export function handwrittenNote(draft: { title: string, body: string }, materials: readonly DeskMaterial[], handTag: string): string {
  const sources = materials.flatMap(material => material.sourceId ? [material.sourceId] : [])
  const related = materials.flatMap(material => material.path ? [`[[${wikiTarget(material.path)}]]`] : [])
  return createV3Note({
    title: draft.title.trim() || null,
    sources,
    related,
    tags: [handTag],
  }, draft.body.trim() ? `${draft.body.trim()}\n` : '')
}

export function mergeDeskDraft(
  draft: { title: string, body: string },
  materials: readonly DeskMaterial[],
  target: string,
  options: { handTag: string, today: string, reason: string, sourceIds?: readonly string[] },
) {
  const originals = new Map<string, string>()
  for (const material of materials) {
    if (!material.path) continue
    if (material.noteRaw === undefined || material.path === target) throw new Error('Missing original note or invalid merge target')
    originals.set(material.path, material.noteRaw)
  }
  if (originals.size < 2 || !draft.body.trim()) throw new Error('Merging requires at least two notes and a working draft')

  const fields = Array.from(originals.values(), raw => {
    const note = parseV3Note(raw)
    if (note.issues.some(issue => issue.startsWith('sources')) || note.fields.status === 'archived' || note.fields.status === 'superseded') {
      throw new Error('Cannot merge an inactive note or a note with invalid sources')
    }
    return note.fields
  })
  const types = new Set(fields.flatMap(field => field.type ? [field.type] : []))
  const [type] = types
  const sources = Array.from(new Set([
    ...fields.flatMap(field => field.sources),
    ...materials.flatMap(material => material.sourceId ?? []),
    ...(options.sourceIds ?? []),
  ]))
  const content = createV3Note({
    title: draft.title.trim() || null,
    type: types.size === 1 ? type : undefined,
    status: 'valid',
    lastConfirmed: options.today,
    sources,
    tags: [options.handTag, ...fields.flatMap(field => field.tags)],
    domains: fields.flatMap(field => field.domains),
    related: [...Array.from(originals.keys(), path => `[[${wikiTarget(path)}]]`), ...fields.flatMap(field => field.related)]
      .filter(link => link !== target && link !== `[[${wikiTarget(target)}]]`),
  }, `${draft.body.trim()}\n`)
  const writes = Array.from(originals, ([path, before]) => ({
    path, before, after: archiveMergedNote(before, target, options.today, options.reason),
  }))
  return { content, sources, writes }
}

/** 存成筆記的檔名：標題去掉不能用的字元。 */
export function noteFileName(title: string, fallback: string): string {
  const name = title.trim().replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${Array.from(name || fallback).slice(0, 80).join('')}.md`
}
