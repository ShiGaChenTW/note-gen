// Fork：Frontmatter 範本（設定頁維護；編輯器「一鍵建立」與屬性面板共用）。
// 範本只存 YAML 內文（不含 `---`），支援三個變數：
//   {{title}}    筆記檔名（不含副檔名），自動加引號避免冒號等字元破壞 YAML
//   {{date}}     今天，YYYY-MM-DD
//   {{datetime}} 現在，YYYY-MM-DDTHH:mm
import { validatePropertySource, yamlScalarText } from './frontmatter-edit'

export interface FrontmatterTemplate {
  id: string
  name: string
  /** YAML 內文，不含 `---` */
  yaml: string
}

export const DEFAULT_FRONTMATTER_TEMPLATES: FrontmatterTemplate[] = [
  { id: 'default', name: 'Default', yaml: 'title: {{title}}\ncreated: {{date}}\ntags: []\naliases: []\n' },
  { id: 'daily', name: 'Daily', yaml: 'date: {{date}}\ntags: [daily]\n' },
  { id: 'project', name: 'Project', yaml: 'title: {{title}}\nstatus: draft\ndue:\ntags: [project]\n' },
]

export const DEFAULT_FRONTMATTER_TEMPLATE_ID = 'default'

export interface TemplateVars { title: string; now?: Date }

function pad(value: number): string { return String(value).padStart(2, '0') }

export function templateDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function templateDateTime(now: Date): string {
  return `${templateDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 把檔名轉成筆記標題：去掉路徑與 .md。 */
export function titleFromPath(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').replace(/\.md$/i, '')
}

/** 套用變數後的 YAML 內文（結尾保證有換行，空範本回傳空字串）。 */
export function renderTemplateYaml(template: Pick<FrontmatterTemplate, 'yaml'>, vars: TemplateVars): string {
  const now = vars.now ?? new Date()
  const yaml = template.yaml
    .replace(/\{\{\s*title\s*\}\}/g, () => vars.title ? yamlScalarText(vars.title) : '')
    .replace(/\{\{\s*datetime\s*\}\}/g, () => templateDateTime(now))
    .replace(/\{\{\s*date\s*\}\}/g, () => templateDate(now))
    .replace(/\r\n|\r/g, '\n')
  if (!yaml.trim()) return ''
  return yaml.endsWith('\n') ? yaml : yaml + '\n'
}

/** 完整的 frontmatter 區塊原文（含兩條 `---` 與結尾換行）；範本是空的時候回傳空字串。 */
export function renderFrontmatterBlock(template: Pick<FrontmatterTemplate, 'yaml'>, vars: TemplateVars): string {
  const yaml = renderTemplateYaml(template, vars)
  return yaml ? `---\n${yaml}---\n` : ''
}

/** 設定頁存檔前驗證：套用範例變數後必須是合法的 YAML 對應表。 */
export function validateTemplateYaml(yaml: string): string {
  try {
    validatePropertySource(renderTemplateYaml({ yaml }, { title: 'Sample', now: new Date(2026, 0, 2, 3, 4) }))
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** 從儲存值還原範本清單；格式不對或清單為空時回到預設，且保證預設範本 id 存在。 */
export function normalizeFrontmatterTemplates(value: unknown): FrontmatterTemplate[] {
  if (!Array.isArray(value)) return DEFAULT_FRONTMATTER_TEMPLATES.map(item => ({ ...item }))
  const seen = new Set<string>()
  const list: FrontmatterTemplate[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { id, name, yaml } = item as Record<string, unknown>
    if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string' || typeof yaml !== 'string') continue
    seen.add(id)
    list.push({ id, name, yaml })
  }
  return list.length ? list : DEFAULT_FRONTMATTER_TEMPLATES.map(item => ({ ...item }))
}

export function pickDefaultTemplate(templates: FrontmatterTemplate[], defaultId: string): FrontmatterTemplate | undefined {
  return templates.find(item => item.id === defaultId) ?? templates[0]
}
