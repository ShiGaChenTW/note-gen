// Fork（almanac）：V3 筆記工具列的「標籤」——讀寫 frontmatter 的 tags。純函式。
// 寫法跟屬性卡片（frontmatter-card-view.tsx）一致：只改 tags 那一行（applyFrontmatterEditToBlock），
// 移除最後一個標籤時留下 `tags: []`（卡片拿掉最後一個 chip 也是這樣）；沒有 frontmatter 時新建一段只有 tags 的。
import {
  applyFrontmatterEdit,
  applyFrontmatterEditToBlock,
  listProperties,
  type PropertyType,
} from '@/lib/markdown/frontmatter-edit'

const TAGS_KEY = 'tags'

/** 標籤輸入：去掉前後空白與開頭的 #（同屬性卡片）。 */
export function normalizeTagInput(input: string): string {
  return input.trim().replace(/^#+/, '').trim()
}

/** 加一個標籤；空字串或已存在（不分大小寫）時原樣回傳。 */
export function addTag(current: readonly string[], input: string): string[] {
  const tag = normalizeTagInput(input)
  if (!tag) return [...current]
  const lower = tag.toLowerCase()
  if (current.some(item => normalizeTagInput(item).toLowerCase() === lower)) return [...current]
  return [...current, tag]
}

/** 拿掉指定位置的標籤。 */
export function removeTagAt(current: readonly string[], index: number): string[] {
  return current.filter((_, i) => i !== index)
}

export interface FrontmatterTags {
  tags: string[]
  /** false：tags 是巢狀等卡片也不能直接改的格式，或 frontmatter 解析失敗；只能看不能改 */
  editable: boolean
}

/** 從 frontmatter 區塊（含 --- 分隔線）讀出 tags；raw 為 null 代表這篇沒有 frontmatter。 */
export function readFrontmatterTags(raw: string | null, types: Record<string, PropertyType> = {}): FrontmatterTags {
  if (!raw) return { tags: [], editable: true }
  try {
    const property = listProperties(raw, types).find(item => item.key === TAGS_KEY)
    if (!property) return { tags: [], editable: true }
    const value = property.value
    const tags = (Array.isArray(value) ? value : value == null || value === '' ? [] : [value])
      .map(item => normalizeTagInput(String(item)))
      .filter(Boolean)
    return { tags, editable: property.editable && property.type !== 'unsupported' }
  } catch {
    return { tags: [], editable: false }
  }
}

export type TagsWritePlan =
  | { kind: 'none' }
  | { kind: 'update'; raw: string }
  | { kind: 'insert'; raw: string }

/**
 * 算出寫回 frontmatter 的方式。
 * - 有 frontmatter：只改 tags 那一行，回傳新的區塊（update）；內容沒變時回傳 none。
 * - 沒有 frontmatter：有標籤才新建一段（insert），沒標籤就不動（none）。
 * 格式不能直接改（巢狀、解析失敗）時丟出錯誤，由呼叫端提示。
 */
export function planTagsWrite(raw: string | null, tags: readonly string[], types: Record<string, PropertyType> = {}): TagsWritePlan {
  const edit = { kind: 'set' as const, key: TAGS_KEY, value: [...tags], type: 'tags' as const }
  if (!raw) {
    if (tags.length === 0) return { kind: 'none' }
    return { kind: 'insert', raw: applyFrontmatterEdit('', edit, types) }
  }
  const next = applyFrontmatterEditToBlock(raw, edit, types)
  return next === raw ? { kind: 'none' } : { kind: 'update', raw: next }
}
