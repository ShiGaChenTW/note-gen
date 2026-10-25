// Fork（#34）：知識報告的資料來源（I/O 層）。只讀不寫 vault；快取寫在 app 資料目錄。
// 分析與彙整都在純函式（note-signals / aggregate / topics）；這裡負責讀檔、PDF、記憶、設定。
import { BaseDirectory, exists, mkdir, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { getAllMemories } from '@/db/memories'
import { readNote } from '@/lib/daily/note-io'
import { parseLocalDocument } from '@/lib/document-parser'
import { getDefaultArticleAbsolutePath, getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useDailySettingsStore from '@/stores/daily-settings'
import useHomeActivityStore from '@/stores/home-activity'
import useVaultIndexStore from '@/stores/vault-index'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import { aggregateTopics, noteRole, type AggregateInput, type PdfInput, type TopicResult } from './aggregate'
import { applyRefresh, editDaysOf, normalizeCache, planRefresh, type NoteUpdate, type ReportCache } from './cache'
import { analyzeNote, analyzeSummary, countWords } from './note-signals'
import { assignTopics, candidateTopics, confirmedTopics, parseTopicList, TOPIC_LIST_PATH, uncoveredNotes, type Topic, type TopicList } from './topics'

/** store.json：知識報告排除的資料夾（vault 相對路徑）。被排除的內容永遠不送給模型。 */
export const EXCLUDE_FOLDERS_KEY = 'knowledgeReportExcludeFolders'

const CACHE_DIR = 'knowledge-report'
const READ_CONCURRENCY = 4

function cacheFile(workspace: string) {
  let hash = 5381
  for (let i = 0; i < workspace.length; i++) hash = ((hash << 5) + hash + workspace.charCodeAt(i)) >>> 0
  return `${CACHE_DIR}/${hash.toString(36)}.json`
}

async function loadCache(workspace: string): Promise<ReportCache> {
  try {
    const file = cacheFile(workspace)
    if (!await exists(file, { baseDir: BaseDirectory.AppData })) return normalizeCache(null, workspace)
    return normalizeCache(JSON.parse(await readTextFile(file, { baseDir: BaseDirectory.AppData })), workspace)
  } catch (error) {
    console.warn('[knowledge-report] cache unreadable, rebuilding:', error)
    return normalizeCache(null, workspace)
  }
}

export async function saveReportCache(cache: ReportCache): Promise<void> {
  if (!await exists(CACHE_DIR, { baseDir: BaseDirectory.AppData })) {
    await mkdir(CACHE_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
  await writeTextFile(cacheFile(cache.workspace), JSON.stringify(cache), { baseDir: BaseDirectory.AppData })
}

export async function getExcludeFolders(): Promise<string[]> {
  try {
    const saved = await (await Store.load('store.json')).get<unknown>(EXCLUDE_FOLDERS_KEY)
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim()) : []
  } catch {
    return []
  }
}

export async function setExcludeFolders(folders: string[]): Promise<void> {
  const store = await Store.load('store.json')
  await store.set(EXCLUDE_FOLDERS_KEY, folders.map(folder => folder.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean))
  await store.save()
}

export async function loadTopicList(): Promise<TopicList | null> {
  const content = await readNote(TOPIC_LIST_PATH).catch(() => null)
  return content === null ? null : parseTopicList(content)
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function absolutePath(relativePath: string): Promise<string> {
  const workspace = await getWorkspacePath()
  if (workspace.isCustom) return `${workspace.path.replace(/\/+$/, '')}/${relativePath}`
  return getDefaultArticleAbsolutePath(relativePath)
}

async function fileMtime(relativePath: string): Promise<number | null> {
  try {
    const options = await getFilePathOptions(relativePath)
    const info = options.baseDir ? await stat(options.path, { baseDir: options.baseDir }) : await stat(options.path)
    return info.mtime ? new Date(info.mtime).getTime() : 0
  } catch {
    return null
  }
}

/** 與編輯器的附件解析相同：本篇同資料夾、vault 根目錄（wikilink-embed-view.tsx resolveAttachmentPath）。 */
function pdfCandidates(target: string, sourcePath: string): string[] {
  const clean = target.trim().replace(/\\/g, '/').replace(/^\.?\//, '')
  const folder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
  return [...new Set([folder ? `${folder}/${clean}` : clean, clean])]
}

async function collectPdfs(notes: IndexedNote[], cache: ReportCache): Promise<{ pdfs: Map<string, PdfInput>; cache: ReportCache; read: number }> {
  const wanted = new Map<string, string[]>()
  for (const note of notes) {
    for (const link of note.links) {
      if (!/\.pdf$/i.test(link.target)) continue
      const key = `${note.path}\n${link.target}`
      if (!wanted.has(key)) wanted.set(key, pdfCandidates(link.target, note.path))
    }
  }
  const resolved = new Map<string, number>()
  for (const candidates of wanted.values()) {
    for (const candidate of candidates) {
      if (resolved.has(candidate)) break
      const mtime = await fileMtime(candidate)
      if (mtime !== null) {
        resolved.set(candidate, mtime)
        break
      }
    }
  }
  const pdfs = new Map<string, PdfInput>()
  const nextPdfs = { ...cache.pdfs }
  let read = 0
  await mapLimit([...resolved], 2, async ([path, mtime]) => {
    const hit = nextPdfs[path]
    if (hit && hit.mtime === mtime) {
      pdfs.set(path, { path, words: hit.words })
      return
    }
    try {
      const parsed = await parseLocalDocument(await absolutePath(path), path)
      const words = countWords(parsed.markdown)
      nextPdfs[path] = { mtime, words }
      pdfs.set(path, { path, words })
      read++
    } catch (error) {
      console.warn('[knowledge-report] pdf unreadable:', path, error)
    }
  })
  for (const path of Object.keys(nextPdfs)) if (!resolved.has(path)) delete nextPdfs[path]
  return { pdfs, cache: { ...cache, pdfs: nextPdfs }, read }
}

export interface ReportSources {
  input: AggregateInput
  topicList: TopicList | null
  cache: ReportCache
  stats: { notes: number; read: number; cached: number; pdfRead: number }
}

export class ReportSourceError extends Error {
  constructor(readonly code: 'indexNotReady') {
    super(code)
  }
}

/** 讀齊所有資料來源；只重讀 mtime 改變的筆記與 PDF，並更新快取。 */
export async function loadReportSources(): Promise<ReportSources> {
  const index = useVaultIndexStore.getState()
  if (index.status !== 'ready') throw new ReportSourceError('indexNotReady')
  const notes = [...index.notes.values()]
  const workspace = index.workspace
  await useDailySettingsStore.getState().initSettings()
  await useHomeActivityStore.getState().load()
  const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
  const excludeFolders = await getExcludeFolders()
  const daily = { folder: dailyFolder, pattern: dailyPattern }

  const roles = new Map(notes.map(note => [note.path, noteRole(note, { daily, excludeFolders })]))
  const analyzed = notes.filter(note => roles.get(note.path) === 'note' || roles.get(note.path) === 'summary')
  let cache = await loadCache(workspace)
  const plan = planRefresh(cache, new Map(analyzed.map(note => [note.path, note.mtime])))
  const byPath = new Map(notes.map(note => [note.path, note]))
  const updates = (await mapLimit(plan.stale, READ_CONCURRENCY, async (path): Promise<NoteUpdate | null> => {
    const note = byPath.get(path)!
    const content = await readNote(path).catch(() => null)
    if (content === null) return null
    return roles.get(path) === 'summary'
      ? { path, mtime: note.mtime, summary: analyzeSummary(content) }
      : { path, mtime: note.mtime, analysis: analyzeNote(content, note.frontmatter) }
  })).filter((update): update is NoteUpdate => update !== null)
  cache = applyRefresh(cache, updates, plan.removed)

  const regular = notes.filter(note => roles.get(note.path) === 'note')
  const pdfResult = await collectPdfs(regular, cache)
  cache = pdfResult.cache
  await saveReportCache(cache).catch(error => console.warn('[knowledge-report] cache save failed:', error))

  const memories = (await getAllMemories({ status: 'active' }).catch(() => [])).map(memory => ({
    id: memory.id, content: memory.content, kind: memory.kind, status: memory.status,
  }))
  const topicList = await loadTopicList()
  const analyses = new Map(Object.entries(cache.notes).flatMap(([path, entry]) => entry.analysis ? [[path, entry.analysis] as const] : []))
  const summaries = new Map(Object.entries(cache.notes).flatMap(([path, entry]) => entry.summary ? [[path, entry.summary] as const] : []))
  return {
    input: {
      topics: topicList ? confirmedTopics(topicList) : [],
      notes,
      analyses,
      summaries,
      editDays: editDaysOf(cache),
      pdfs: pdfResult.pdfs,
      activity: useHomeActivityStore.getState().log,
      memories,
      daily,
      excludeFolders,
    },
    topicList,
    cache,
    stats: { notes: analyzed.length, read: updates.length, cached: analyzed.length - updates.length, pdfRead: pdfResult.read },
  }
}

export interface KnowledgeSnapshot {
  results: TopicResult[]
  /** 主題清單還沒有的候選（標籤、MOC） */
  candidates: Array<Topic & { noteCount: number }>
  /** 沒有歸到任何已確認主題的一般筆記（給 AI 提議用；已排除被排除的資料夾） */
  uncovered: IndexedNote[]
  sources: ReportSources
}

/** 一次算出所有主題的掌握度，以及建立基準需要的候選與未歸類筆記。 */
export async function computeKnowledgeSnapshot(): Promise<KnowledgeSnapshot> {
  const sources = await loadReportSources()
  const { input } = sources
  const results = aggregateTopics(input)
  const regular = input.notes.filter(note => noteRole(note, input) === 'note')
  const known = new Set((sources.topicList?.topics ?? []).map(topic => topic.name.toLowerCase()))
  const candidates = candidateTopics(regular).filter(topic => !known.has(topic.name.toLowerCase()))
  // 清單裡（含待確認）與候選主題已涵蓋的都不算未歸類，AI 只提議剩下的
  const assignment = assignTopics([...(sources.topicList?.topics ?? []), ...candidates], regular)
  return { results, candidates, uncovered: uncoveredNotes(regular, assignment), sources }
}
