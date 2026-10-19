import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { splitFrontmatter } from './frontmatter-split'

export type PropertyType = 'text' | 'multitext' | 'number' | 'checkbox' | 'date' | 'datetime' | 'tags' | 'aliases' | 'unsupported'
export interface Property { key: string; value: unknown; type: PropertyType; editable: boolean; raw: string }
export type FrontmatterEdit =
  | { kind: 'set'; key: string; value: unknown; type: PropertyType }
  | { kind: 'remove'; key: string }
  | { kind: 'rename'; key: string; newKey: string }
  | { kind: 'replaceSource'; yaml: string }

export function inferPropertyType(key: string, value: unknown, typeMap: Record<string, PropertyType> = {}): PropertyType {
  if ((value !== null && typeof value === 'object' && !Array.isArray(value))
    || (typeof value === 'string' && /[\r\n]/.test(value))
    || (Array.isArray(value) && value.some(item => item !== null && typeof item === 'object' || typeof item === 'string' && /[\r\n]/.test(item)))) return 'unsupported'
  if (Object.hasOwn(typeMap, key)) return typeMap[key]
  if (key === 'tags') return 'tags'
  if (key === 'aliases') return 'aliases'
  if (key === 'cssclasses') return 'multitext'
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return 'datetime'
  if (Array.isArray(value)) return 'multitext'
  return 'text'
}

function sourceParts(block: string) {
  const opening = block.match(/^\uFEFF?[^\r\n]*(?:\r\n|\n|\r)/)?.[0] ?? ''
  const closing = /(?:^|\n|\r)([\t ]*(?:---|\.\.\.)[\t ]*(?:\r\n|\n|\r)?)$/.exec(block)
  const end = closing ? closing.index + (block[closing.index] === '\r' || block[closing.index] === '\n' ? 1 : 0) : block.length
  return { opening, yaml: block.slice(opening.length, end), closing: block.slice(end) }
}

function documentOf(yaml: string) {
  const doc = parseDocument(yaml, { uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors.map(error => error.message).join('\n'))
  if (doc.contents && !isMap(doc.contents)) throw new Error('屬性必須是 YAML 對應表')
  return doc
}

export function validatePropertySource(yaml: string): void { documentOf(yaml) }

export function listProperties(block: string, typeMap: Record<string, PropertyType> = {}): Property[] {
  if (!block) return []
  const { yaml } = sourceParts(block)
  const doc = documentOf(yaml)
  if (!isMap(doc.contents)) return []
  const root = doc.contents
  return root.items.map(pair => {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('屬性名稱必須是文字')
    const key = pair.key.value
    const value: unknown = pair.value?.toJSON() ?? null
    const start = pair.key.range?.[0] ?? 0
    const end = pair.value?.range?.[2] ?? pair.key.range?.[2] ?? start
    const raw = yaml.slice(start, end).replace(/(?:\r\n|\n|\r)$/, '')
    const inferred = inferPropertyType(key, value, typeMap)
    const node = pair.value
    const multiline = isScalar(node) && (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED'
      || !!node.range && /[\r\n]/.test(yaml.slice(node.range[0], node.range[1])))
    // 錨點與別名必須一起維護，避免逐欄編輯產生失效參照。
    const referenced = isAlias(node) || (isScalar(node) || isSeq(node) || isMap(node)) && !!node.anchor
    const type = multiline || referenced ? 'unsupported' : inferred
    return { key, value, type, editable: type !== 'unsupported' && !root.flow, raw }
  })
}

/** 用 YAML 解析後的型別驗證裸字串，避免 true、數字或特殊字元改變語意。 */
function scalar(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('數字必須是有限值')
    return String(value)
  }
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('不支援的屬性值')
  const parsed = parseDocument(value)
  if (!value || value.trim() !== value || /#|: |^[\["']/.test(value)
    || parsed.errors.length || !isScalar(parsed.contents) || parsed.toJS() !== value) return JSON.stringify(value)
  return value
}

function serializedValue(value: unknown, type: PropertyType, eol: string): string {
  if (type === 'unsupported') throw new Error('請使用原始碼編輯')
  if (['multitext', 'tags', 'aliases'].includes(type)) {
    if (!Array.isArray(value)) throw new Error('清單屬性必須是陣列')
    return value.length ? eol + value.map(item => `  - ${scalar(item)}`).join(eol) : ' []'
  }
  if (type === 'number' && typeof value !== 'number') throw new Error('數字格式錯誤')
  if (type === 'checkbox' && typeof value !== 'boolean') throw new Error('核取方塊格式錯誤')
  return ` ${scalar(value)}`
}

export function applyFrontmatterEdit(content: string, edit: FrontmatterEdit, typeMap: Record<string, PropertyType> = {}): string {
  const { block, body } = splitFrontmatter(content)
  const eol = content.match(/\r\n|\n|\r/)?.[0] ?? '\n'
  const parts = block ? sourceParts(block) : { opening: `---${eol}`, yaml: '', closing: `---${eol}` }
  if (edit.kind === 'replaceSource') {
    validatePropertySource(edit.yaml)
    const yaml = edit.yaml.replace(/\r\n|\r|\n/g, eol)
    const next = yaml && !yaml.endsWith(eol) ? yaml + eol : yaml
    if (block) return parts.opening + next + parts.closing + body
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
    return bom + parts.opening + next + parts.closing + content.slice(bom.length)
  }
  const doc = documentOf(parts.yaml)
  if (isMap(doc.contents) && doc.contents.flow) throw new Error('請使用原始碼編輯 flow 對應表')
  const pairs = isMap(doc.contents) ? doc.contents.items : []
  const pair = pairs.find(item => isScalar(item.key) && item.key.value === edit.key)
  const keyNode = pair?.key
  let yaml = parts.yaml
  if (edit.kind === 'rename') {
    if (!edit.newKey.trim()) throw new Error('屬性名稱不可為空')
    if (edit.newKey === edit.key || !pair) return content
    if (pairs.some(item => isScalar(item.key) && item.key.value === edit.newKey)) throw new Error('屬性名稱已存在')
    if (!isScalar(keyNode) || !keyNode.range) throw new Error('屬性名稱格式錯誤')
    yaml = yaml.slice(0, keyNode.range[0]) + scalar(edit.newKey) + yaml.slice(keyNode.range[1])
  } else if (edit.kind === 'remove') {
    if (!pair || !isScalar(keyNode) || !keyNode.range) return content
    if (pairs.length === 1) return (block.startsWith('\uFEFF') ? '\uFEFF' : '') + body
    const start = yaml.lastIndexOf('\n', keyNode.range[0] - 1) + 1
    const end = pair.value?.range?.[2] ?? keyNode.range[2]
    // 空值的範圍也包含該行註解與換行。
    yaml = yaml.slice(0, start) + yaml.slice(end)
  } else {
    if (!edit.key.trim()) throw new Error('屬性名稱不可為空')
    const value = serializedValue(edit.value, edit.type, eol)
    if (pair && isScalar(keyNode) && keyNode.range) {
      const property = listProperties(block, typeMap).find(item => item.key === edit.key)
      if (!property?.editable) throw new Error('請使用原始碼編輯')
      const colon = yaml.indexOf(':', keyNode.range[1])
      const node = pair.value
      const end = node?.range?.[2] ?? keyNode.range[2]
      const original = yaml.slice(colon + 1, end)
      // 保留同一行註解；集合內的註解屬於被編輯的 key。
      const inlineComment = isScalar(node) && node.comment ? ` #${node.comment}` : ''
      const headerComment = isSeq(node) ? original.split(/\r?\n/)[0].match(/\s+#.*$/)?.[0] ?? '' : ''
      const comment = inlineComment || headerComment
      const rendered = value.startsWith(eol) && comment ? comment + value : value + comment
      const trailing = /[\r\n]$/.test(original) ? eol : ''
      yaml = yaml.slice(0, colon + 1) + rendered + trailing + yaml.slice(end)
    } else {
      yaml += (yaml && !/[\r\n]$/.test(yaml) ? eol : '') + `${scalar(edit.key)}:${value}${eol}`
    }
  }
  const result = parts.opening + yaml + parts.closing
  if (block) return result + body
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
  return bom + result + content.slice(bom.length)
}
