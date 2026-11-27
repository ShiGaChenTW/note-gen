// Fork（almanac ALMNC-89）：結束專案／取消封存的 I/O——筆記索引、編輯器協調改寫、目前脈絡、store.json。
// 流程與規則在 archive.ts（純邏輯，測試用假的依賴）。
import { ARCHIVED_PROJECTS_KEY, findProjectNotes, sanitizeArchivedProjects, type ArchivedProjectMap, type ProjectArchiveDeps } from './archive'

interface ArchiveStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<ArchiveStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export async function loadArchivedProjects(storage?: ArchiveStorage): Promise<ArchivedProjectMap> {
  try {
    const store = storage ?? await defaultStorage()
    return sanitizeArchivedProjects(await store.get(ARCHIVED_PROJECTS_KEY))
  } catch {
    return {}
  }
}

export async function saveArchivedProjects(map: ArchivedProjectMap, storage?: ArchiveStorage): Promise<boolean> {
  try {
    const store = storage ?? await defaultStorage()
    await store.set(ARCHIVED_PROJECTS_KEY, map)
    await store.save()
    return true
  } catch {
    return false
  }
}

export function createProjectArchiveDeps(): ProjectArchiveDeps {
  return {
    now: () => Date.now(),
    findProjectNotes: async name => {
      const { default: useVaultIndexStore, waitForVaultIndexSettled } = await import('@/stores/vault-index')
      // 剛啟動、索引還沒掃完就結束專案：等它掃完，否則會找不到專案筆記、一篇都沒封存。
      await waitForVaultIndexSettled()
      return findProjectNotes(useVaultIndexStore.getState().notes.values(), name)
    },
    rewriteNote: async (path, rewrite) => {
      // 經編輯器協調寫入：開著的那篇以編輯器內容為準，寫完通知編輯器重新載入。
      // 檔案已經不在（被搬走或刪掉）時 rewriteNote 不寫、回傳 null。
      const { rewriteNote } = await import('@/lib/note-rewrite')
      const result = await rewriteNote(path, rewrite)
      return result ? result.previousContent : null
    },
    getContext: async () => {
      const { getSharedContext } = await import('@/db/agent-memory')
      const { projects, weeklyFocus, people } = await getSharedContext()
      return { projects, weeklyFocus, people }
    },
    saveContext: async context => {
      const { saveSharedContext } = await import('@/db/agent-memory')
      // 結束專案是 Scott 按的，以 Scott 的身分改脈絡（同設定頁）。
      await saveSharedContext('scott', context)
    },
  }
}
