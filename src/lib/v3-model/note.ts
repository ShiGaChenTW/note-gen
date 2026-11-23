// Fork（almanac ALMNC-54.1）：第二層「筆記」——知識、紀錄、專案三類。筆記仍是 vault 裡的 Markdown，
// V3 欄位寫在 YAML frontmatter；這裡負責解析與寫回，未知欄位、註解與內文一律保留。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第一節 §2、§4。
import { isMap, parseDocument, type Document } from 'yaml'
import { joinFrontmatter, splitFrontmatter } from '@/lib/markdown/frontmatter-split'

/** 知識筆記、紀錄筆記、專案筆記。 */
export type NoteType = 'knowledge' | 'record' | 'project'
/** 有效、待查證、已被取代、封存。 */
export type NoteStatus = 'valid' | 'disputed' | 'superseded' | 'archived'

export const NOTE_TYPES: readonly NoteType[] = ['knowledge', 'record', 'project']
/** Fork（almanac ALMNC-69.3）：日誌筆記的新類型值（Scott 定 record → log）；目前只在讀取時接受。 */
export const LOG_NOTE_TYPE = 'log'
export const NOTE_STATUSES: readonly NoteStatus[] = ['valid', 'disputed', 'superseded', 'archived']

/** frontmatter 裡由 V3 管理的欄位；其餘 key 一律原樣保留。 */
export const V3_NOTE_KEYS = ['title', 'type', 'summary', 'sources', 'tags', 'related', 'domains', 'status', 'lastConfirmed'] as const
export type V3NoteKey = typeof V3_NOTE_KEYS[number]

export interface V3NoteFields {
  /** frontmatter 沒寫時，由 noteTitle() 退回第一個 H1 或檔名。 */
  title?: string
  type?: NoteType
  summary?: string
  /** 來源資料源的 id。 */
  sources: string[]
  tags: string[]
  /** 相關筆記（vault 相對路徑或 [[標題]]）。 */
  related: string[]
  /** 所屬領域的 id；可以多個。 */
  domains: string[]
  status?: NoteStatus
  /** 最後確認日期，YYYY-MM-DD。 */
  lastConfirmed?: string
}

export interface ParsedV3Note {
  fields: V3NoteFields
  /** 非 V3 欄位（原樣保留，供檢視用）。 */
  extra: Record<string, unknown>
  /** 內文：frontmatter 之後的全部文字。 */
  body: string
  /** 欄位格式不對時的說明；對應欄位會被當成沒填。 */
  issues: string[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function stringList(value: unknown, key: string, issues: string[]): string[] {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) {
    issues.push(`${key} 必須是清單`)
    return []
  }
  const items = value.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).trim()).filter(Boolean)
  if (items.length !== value.length) issues.push(`${key} 只能放文字`)
  return Array.from(new Set(items))
}

function optionalString(value: unknown, key: string, issues: string[]): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    issues.push(`${key} 必須是文字`)
    return undefined
  }
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], key: string, issues: string[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  issues.push(`${key} 必須是 ${allowed.join('、')} 其中之一`)
  return undefined
}

function documentOf(yaml: string): Document {
  const doc = parseDocument(yaml, { uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors.map(error => error.message).join('\n'))
  if (doc.contents && !isMap(doc.contents)) throw new Error('frontmatter 必須是 YAML 對應表')
  return doc
}

/** 去掉前後兩條 `---`，只留 YAML 本體。 */
function yamlOf(block: string): string {
  const lines = block.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  // 第一行是開頭的 ---；最後一條 ---/... 之後可能還有一個空字串（結尾換行）。
  let end = lines.length - 1
  while (end > 0 && !/^\s*(---|\.\.\.)\s*$/.test(lines[end])) end--
  return lines.slice(1, end).join('\n')
}

export function parseV3Note(raw: string): ParsedV3Note {
  const { block, body } = splitFrontmatter(raw)
  const issues: string[] = []
  const data = block ? (documentOf(yamlOf(block)).toJS() as Record<string, unknown> | null) ?? {} : {}
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!(V3_NOTE_KEYS as readonly string[]).includes(key)) extra[key] = value
  }
  let lastConfirmed: string | undefined
  const rawDate = data.lastConfirmed as unknown
  if (rawDate instanceof Date) lastConfirmed = rawDate.toISOString().slice(0, 10)
  else if (typeof rawDate === 'string' && DATE.test(rawDate)) lastConfirmed = rawDate
  else if (rawDate !== undefined && rawDate !== null && rawDate !== '') issues.push('lastConfirmed 必須是 YYYY-MM-DD')
  return {
    fields: {
      title: optionalString(data.title, 'title', issues),
      // Fork（almanac ALMNC-69.3）：日誌筆記的新類型值 log（範例 vault 已用）讀起來當成現行的 record；寫入與既有資料遷移在 ALMNC-69.4。
      type: data.type === LOG_NOTE_TYPE ? 'record' : enumValue(data.type, NOTE_TYPES, 'type', issues),
      summary: optionalString(data.summary, 'summary', issues),
      sources: stringList(data.sources, 'sources', issues),
      tags: stringList(data.tags, 'tags', issues),
      related: stringList(data.related, 'related', issues),
      domains: stringList(data.domains, 'domains', issues),
      status: enumValue(data.status, NOTE_STATUSES, 'status', issues),
      lastConfirmed,
    },
    extra,
    body,
    issues,
  }
}

/** 標題：frontmatter 的 title → 內文第一個 H1 → 檔名（去掉資料夾與 .md）。 */
export function noteTitle(note: Pick<ParsedV3Note, 'fields' | 'body'>, path?: string): string {
  if (note.fields.title?.trim()) return note.fields.title.trim()
  const heading = note.body.match(/^#[ \t]+(.+?)[ \t#]*$/m)?.[1]?.trim()
  if (heading) return heading
  return (path ?? '').split('/').pop()?.replace(/\.md$/i, '') ?? ''
}

/** undefined＝不動；null 或空清單／空字串＝移除該欄位。 */
export type V3NoteFieldsPatch = { [K in V3NoteKey]?: V3NoteFields[K] | null }

function validatePatch(patch: V3NoteFieldsPatch) {
  if (patch.type && !NOTE_TYPES.includes(patch.type)) throw new Error(`未知的筆記類型：${patch.type}`)
  if (patch.status && !NOTE_STATUSES.includes(patch.status)) throw new Error(`未知的筆記狀態：${patch.status}`)
  if (patch.lastConfirmed && !DATE.test(patch.lastConfirmed)) throw new Error('lastConfirmed 必須是 YYYY-MM-DD')
}

/**
 * 把 V3 欄位寫進 Markdown 原文，回傳新原文。只改 patch 指定的 key；
 * 其他 frontmatter 欄位、註解、BOM 與內文都保留。原文沒有 frontmatter 時會新增一個。
 */
export function writeV3NoteFields(raw: string, patch: V3NoteFieldsPatch): string {
  validatePatch(patch)
  const { block, body } = splitFrontmatter(raw)
  const bom = raw.startsWith('﻿') ? '﻿' : ''
  const doc = documentOf(block ? yamlOf(block) : '')
  for (const key of V3_NOTE_KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === undefined) continue
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      doc.delete(key)
      continue
    }
    if (Array.isArray(value)) {
      const node = doc.createNode(Array.from(new Set(value)))
      node.flow = true
      doc.set(key, node)
    } else {
      doc.set(key, value)
    }
  }
  const empty = !doc.contents || (isMap(doc.contents) && doc.contents.items.length === 0)
  if (empty && !doc.commentBefore && !doc.comment) return bom + body
  const yaml = doc.toString({ lineWidth: 0 })
  return bom + joinFrontmatter(`---\n${yaml}---\n`, body)
}

/** 新筆記：由欄位與內文組成完整 Markdown。 */
export function createV3Note(fields: V3NoteFieldsPatch, body: string): string {
  // 內文不經 frontmatter 解析，避免內文本身以 --- 開頭時被誤判。
  return joinFrontmatter(writeV3NoteFields('', fields), body)
}
