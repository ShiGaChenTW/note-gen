/**
 * F3 vault 索引服務（I/O 層）：
 * 1. 讀 app 資料目錄的快取（不寫進 vault）
 * 2. 列出全 vault 的 .md，只重讀新增或 mtime 改變的檔案
 * 3. 用 Tauri fs watch 增量更新；沒有路徑的事件才整份重掃
 * 解析與比對邏輯在 index-note.ts / index-core.ts。
 */

import { appDataDir, join } from '@tauri-apps/api/path'
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  stat,
  watch,
  writeTextFile,
  type WatchEvent,
} from '@tauri-apps/plugin-fs'
import { getAllMarkdownFiles } from '@/lib/files'
import { getFilePathOptions } from '@/lib/workspace'
import useVaultIndexStore from '@/stores/vault-index'
import { indexNote, type IndexedNote } from './index-note'
import {
  planScan,
  restoreIndexCache,
  serializeIndexCache,
  toIndexablePath,
  type ListedFile,
} from './index-core'

const CACHE_DIR = 'vault-index'
const READ_CONCURRENCY = 8
const CACHE_SAVE_DELAY_MS = 2000

function cacheFileName(workspace: string): string {
  // 簡單的字串雜湊，讓每個工作區各有一份快取
  let hash = 5381
  for (let i = 0; i < workspace.length; i++) hash = ((hash << 5) + hash + workspace.charCodeAt(i)) >>> 0
  return `${CACHE_DIR}/${hash.toString(36)}.json`
}

async function loadCache(workspace: string): Promise<Map<string, IndexedNote>> {
  const file = cacheFileName(workspace)
  try {
    if (!await exists(file, { baseDir: BaseDirectory.AppData })) return new Map()
    return restoreIndexCache(JSON.parse(await readTextFile(file, { baseDir: BaseDirectory.AppData })), workspace)
  } catch (error) {
    console.warn('[vault-index] cache unreadable, rebuilding:', error)
    return new Map()
  }
}

async function saveCache(workspace: string, notes: Map<string, IndexedNote>): Promise<void> {
  if (!await exists(CACHE_DIR, { baseDir: BaseDirectory.AppData })) {
    await mkdir(CACHE_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
  const payload = serializeIndexCache(workspace, notes.values(), Date.now())
  await writeTextFile(cacheFileName(workspace), JSON.stringify(payload), { baseDir: BaseDirectory.AppData })
}

async function readNote(relativePath: string): Promise<{ content: string, mtime: number } | null> {
  const options = await getFilePathOptions(relativePath)
  const fsOptions = options.baseDir ? { baseDir: options.baseDir } : undefined
  try {
    const [content, info] = await Promise.all([
      readTextFile(options.path, fsOptions),
      stat(options.path, fsOptions),
    ])
    return { content, mtime: info.mtime?.getTime() ?? 0 }
  } catch {
    // 讀檔期間被刪除或改名
    return null
  }
}

async function indexPaths(paths: string[]): Promise<{ indexed: IndexedNote[], missing: string[] }> {
  const indexed: IndexedNote[] = []
  const missing: string[] = []
  let cursor = 0
  async function worker() {
    while (cursor < paths.length) {
      const path = paths[cursor++]
      const file = await readNote(path)
      if (file) indexed.push(indexNote(path, file.content, file.mtime))
      else missing.push(path)
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, paths.length) }, worker))
  return { indexed, missing }
}

async function listVault(): Promise<ListedFile[]> {
  const files = await getAllMarkdownFiles(true)
  return files.map(file => ({
    path: file.relativePath,
    mtime: file.metadata?.modifiedAt ? new Date(file.metadata.modifiedAt).getTime() : 0,
  }))
}

/** 資料夾被刪除、改名或搬入時，事件只帶資料夾路徑，要整份比對才能找出底下的筆記 */
function touchesFolder(event: WatchEvent, workspaceKey: string): boolean {
  const type = event.type
  const structural = typeof type === 'string'
    || 'create' in type
    || 'remove' in type
    || ('modify' in type && type.modify.kind === 'rename')
  if (!structural) return false
  return event.paths.some(path => {
    const normalized = path.replace(/\\/g, '/')
    if (!normalized.startsWith(`${workspaceKey}/`)) return false
    const relative = normalized.slice(workspaceKey.length + 1)
    if (relative.split('/').some(part => part.startsWith('.'))) return false
    return !/\.[^/]+$/.test(relative.split('/').pop() ?? '')
  })
}

export interface VaultIndexHandle {
  stop: () => void
  rescan: () => Promise<void>
}

/**
 * 啟動指定工作區的索引。workspacePath 為空字串時是預設工作區（AppData/article）。
 * 回傳的 stop() 會停止監看並寫出最後一次快取。
 */
export async function startVaultIndex(workspacePath: string): Promise<VaultIndexHandle> {
  const store = useVaultIndexStore.getState()
  const workspaceRoot = workspacePath || await join(await appDataDir(), 'article')
  const workspaceKey = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  store.reset(workspaceKey)

  let stopped = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let scanning: Promise<void> | null = null

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (stopped) return
      void saveCache(workspaceKey, useVaultIndexStore.getState().notes)
        .catch(error => console.warn('[vault-index] cache save failed:', error))
    }, CACHE_SAVE_DELAY_MS)
  }

  const runScan = async (base: Map<string, IndexedNote>, fromCache: boolean) => {
    const started = performance.now()
    useVaultIndexStore.getState().setStatus('scanning')
    const listed = await listVault()
    const plan = planScan(base, listed)
    const { indexed, missing } = await indexPaths(plan.toIndex)
    if (stopped) return

    const next = new Map(base)
    for (const path of [...plan.toRemove, ...missing]) next.delete(path)
    for (const note of indexed) next.set(note.path, note)
    const state = useVaultIndexStore.getState()
    // 掃描期間監看器可能已寫入更新的版本：mtime 較新的保留
    for (const [path, current] of state.notes) {
      const scanned = next.get(path)
      if (scanned && current.mtime > scanned.mtime) next.set(path, current)
    }
    state.replaceAll(next)
    state.setStatus('ready')
    const stats = {
      ms: Math.round(performance.now() - started),
      files: listed.length,
      indexed: indexed.length,
      fromCache,
    }
    state.setLastScan(stats)
    console.info(`[vault-index] ${stats.files} files in ${stats.ms}ms (${stats.indexed} read, cache ${fromCache ? 'hit' : 'miss'})`)
    if (indexed.length > 0 || plan.toRemove.length > 0 || missing.length > 0) scheduleSave()
  }

  const rescan = async () => {
    if (scanning) return scanning
    scanning = runScan(useVaultIndexStore.getState().notes, false)
      .catch(error => {
        console.error('[vault-index] scan failed:', error)
        useVaultIndexStore.getState().setStatus('error', String(error))
      })
      .finally(() => { scanning = null })
    return scanning
  }

  const handleEvent = async (event: WatchEvent) => {
    if (stopped) return
    if (event.paths.length === 0 || touchesFolder(event, workspaceKey)) {
      await rescan()
      return
    }
    const paths = [...new Set(event.paths
      .map(path => toIndexablePath(path, workspaceKey))
      .filter((path): path is string => path !== null))]
    if (paths.length === 0) return
    const { indexed, missing } = await indexPaths(paths)
    if (stopped) return
    const state = useVaultIndexStore.getState()
    state.remove(missing)
    state.upsert(indexed)
    scheduleSave()
  }

  const cached = await loadCache(workspaceKey)
  if (cached.size > 0) {
    // 先讓快取可查詢，再在背景比對差異
    useVaultIndexStore.getState().replaceAll(cached)
  }
  scanning = runScan(cached, cached.size > 0)
    .catch(error => {
      console.error('[vault-index] initial scan failed:', error)
      useVaultIndexStore.getState().setStatus('error', String(error))
    })
    .finally(() => { scanning = null })

  let unwatch: (() => void) | undefined
  try {
    unwatch = await watch(workspaceRoot, event => { void handleEvent(event) }, { recursive: true, delayMs: 300 })
  } catch (error) {
    console.warn('[vault-index] file watcher unavailable; index updates only on rescan:', error)
  }

  return {
    rescan,
    stop: () => {
      stopped = true
      unwatch?.()
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
        void saveCache(workspaceKey, useVaultIndexStore.getState().notes).catch(() => undefined)
      }
    },
  }
}
