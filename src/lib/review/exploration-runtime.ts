import { addSourceIfAbsent, getSource } from '@/db/v3-sources'
import { appStore, defaultLookup } from '@/lib/cleanup/runtime'
import { isExploring } from '@/lib/domain-page/moc-view'
import { createMocIo } from '@/lib/moc/runtime'
import { parseMoc } from '@/lib/moc/parse'
import useVaultIndexStore from '@/stores/vault-index'
import { researchExplorationSources, type ExplorationTopics } from './research'

const WEEKLY_USAGE_KEY = 'almanacExplorationResearchUsage'

export async function loadExplorationTopics(): Promise<Array<ExplorationTopics & { id?: string }>> {
  if (useVaultIndexStore.getState().status !== 'ready') return []
  const files = await createMocIo().listMocFiles()
  return files.map(file => parseMoc(file.raw, file.path))
    .filter(moc => moc.isMoc && isExploring(moc.status))
    .map(moc => ({
      id: moc.id,
      name: moc.name,
      questions: moc.chapters.filter(chapter => !chapter.grownInto && !chapter.unsorted).map(chapter => chapter.title),
    }))
}

async function sourceId(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return `src_exploration:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function runExplorationResearch(topics: readonly ExplorationTopics[], now: Date, limit: number): Promise<void> {
  if (!topics.length || limit <= 0) return
  const [{ requestJudgement, refreshSources }, store] = await Promise.all([import('@/lib/workbench/actions'), appStore()])
  const usage = await store.get(WEEKLY_USAGE_KEY) as { start?: number, count?: number } | undefined
  let count = usage?.start !== undefined && Number.isInteger(usage.count) ? usage.count! : 0
  const added = await researchExplorationSources(topics, {
    lookup: defaultLookup,
    count: async start => {
      if (usage?.start !== start) count = 0
      return count
    },
    register: async ({ url }, start) => {
      const id = await sourceId(url)
      if (await getSource(id)) return false
      // 先記額度，避免寫資料源成功後 App 中斷、重跑時重複支用同一週的額度。
      await store.set(WEEKLY_USAGE_KEY, { start, count: ++count })
      const source = await addSourceIfAbsent({
        id, sourceType: 'external', kind: 'link', content: url, origin: url, collector: 'researcher:exploration',
      })
      if (!source) {
        await store.set(WEEKLY_USAGE_KEY, { start, count: --count })
        return false
      }
      await requestJudgement(source, { refresh: false })
      return true
    },
  }, now, limit)
  if (added) await refreshSources()
}
