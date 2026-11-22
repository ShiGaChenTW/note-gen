// Fork（almanac ALMNC-54.8）：檯面（專注模式）——素材、工作稿、協助三欄。
// 檯面上的結構操作直接生效，不走提案（第四節「檯面上的整理直接生效」）：搬移、加標籤、連結、合併筆記、歸入領域。
// 這裡是純函式與注入的寫入介面；真正寫檔的實作在 desk-io.ts（需要 Tauri）。
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
}

export type StructuralOp =
  | { op: 'move', path: string, folder: string }
  | { op: 'tag', path: string, tag: string }
  | { op: 'link', path: string, target: string }
  | { op: 'assignDomain', path: string, domainId: string }
  | { op: 'merge', paths: string[] }

/** 這張卡片目前能做的結構操作；合併筆記要逐段對照，這張卡先不開放（見 ALMNC-54.8 實作說明）。 */
export const STRUCTURAL_OPS = ['move', 'tag', 'link', 'assignDomain'] as const
export const STUBBED_OPS = ['merge'] as const

export interface NoteIo {
  read: (path: string) => Promise<string | null>
  write: (path: string, content: string) => Promise<void>
  /** 搬到資料夾，回傳新路徑。 */
  move: (path: string, folder: string) => Promise<string>
}

export class DeskOpUnsupported extends Error {
  constructor(readonly op: StructuralOp['op']) {
    super(`desk op not supported yet: ${op}`)
  }
}

function cleanTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/\s+/g, '-')
}

function wikiTarget(path: string): string {
  return path.replace(/\.md$/i, '')
}

/** 執行一個結構操作，回傳操作後筆記的路徑（搬移會改路徑）與能復原的寫入。 */
export async function applyStructuralOp(op: StructuralOp, io: NoteIo): Promise<{ path?: string, undo?: () => Promise<void> }> {
  if (op.op === 'merge') throw new DeskOpUnsupported('merge')
  if (op.op === 'move') {
    const folder = op.folder.trim().replace(/^\/+|\/+$/g, '')
    const from = op.path
    const to = await io.move(from, folder)
    const back = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
    return { path: to, undo: async () => { await io.move(to, back) } }
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
  } else if (op.op === 'assignDomain') {
    if (fields.domains.includes(op.domainId)) return { path: op.path }
    next = writeV3NoteFields(raw, { domains: [...fields.domains, op.domainId] })
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
    body: materials.map(material => `## ${material.title}\n\n${material.text.trim()}`).join('\n\n'),
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

/** 存成筆記的檔名：標題去掉不能用的字元。 */
export function noteFileName(title: string, fallback: string): string {
  const name = title.trim().replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${Array.from(name || fallback).slice(0, 80).join('')}.md`
}
