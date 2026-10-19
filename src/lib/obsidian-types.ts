import { readNote } from '@/lib/daily/note-io'
import useVaultIndexStore from '@/stores/vault-index'
import type { PropertyType } from '@/lib/markdown/frontmatter-edit'

const supported = new Set<PropertyType>(['text', 'multitext', 'number', 'checkbox', 'date', 'datetime', 'tags', 'aliases'])
let cached: { workspace: string; promise: Promise<Record<string, PropertyType>> } | null = null

/** 唯讀快取；工作區切換後下一次呼叫會重新載入。 */
export function loadObsidianPropertyTypes(): Promise<Record<string, PropertyType>> {
  const workspace = useVaultIndexStore.getState().workspace
  if (cached?.workspace === workspace) return cached.promise
  const promise = (async () => {
    try {
      const source = await readNote('.obsidian/types.json')
      const data: unknown = source ? JSON.parse(source) : null
      if (!data || typeof data !== 'object' || !('types' in data) || !data.types || typeof data.types !== 'object' || Array.isArray(data.types)) return {}
      return Object.fromEntries(Object.entries(data.types).filter((entry): entry is [string, PropertyType] => supported.has(entry[1] as PropertyType)))
    } catch { return {} }
  })()
  cached = { workspace, promise }
  return promise
}
