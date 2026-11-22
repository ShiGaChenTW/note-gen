// Fork（almanac）：V3 筆記工具列的「置頂」與「收藏」。每個工作區各一份筆記路徑清單，存在 note-marks.json。
// 置頂的筆記在「我的筆記」中間欄排最上面；收藏目前只存、只在工具列顯示狀態，還沒有其他地方列出。
// 筆記改名／搬移／刪除時跟著改（聽 article store 發的 editor-navigation-path-* 事件，套用到目前的工作區）。
import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { checkIsTauri } from '@/lib/check'
import emitter from '@/lib/emitter'
import {
  moveMarkedPaths,
  noteMarksWorkspaceKey,
  removeMarkedPaths,
  toggleMarkedPath,
} from '@/lib/note-toolbar/note-marks'
import useSettingStore from '@/stores/setting'

export type NoteMarkKind = 'pinned' | 'favorites'

type MarksByWorkspace = Record<string, string[]>

interface NoteMarksState {
  loaded: boolean
  pinned: MarksByWorkspace
  favorites: MarksByWorkspace
  load: () => Promise<void>
  toggle: (kind: NoteMarkKind, workspaceKey: string, path: string) => Promise<void>
}

const STORE_FILE = 'note-marks.json'
const EMPTY: readonly string[] = Object.freeze([])
let storePromise: Promise<Store> | null = null
let loadPromise: Promise<void> | null = null
let saveQueue: Promise<void> = Promise.resolve()

function getStore(): Promise<Store> {
  storePromise ??= Store.load(STORE_FILE, { autoSave: false }).catch(error => {
    storePromise = null
    throw error
  })
  return storePromise
}

function validMarks(value: unknown): MarksByWorkspace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: MarksByWorkspace = {}
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(list)) result[key] = list.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  return result
}

function save(pinned: MarksByWorkspace, favorites: MarksByWorkspace): Promise<void> {
  if (!checkIsTauri()) return Promise.resolve()
  const snapshot = { pinned: { ...pinned }, favorites: { ...favorites } }
  const task = saveQueue.catch(() => {}).then(async () => {
    const store = await getStore()
    await store.set('pinned', snapshot.pinned)
    await store.set('favorites', snapshot.favorites)
    await store.save()
  })
  saveQueue = task
  return task
}

const useNoteMarksStore = create<NoteMarksState>((set, get) => ({
  loaded: false,
  pinned: {},
  favorites: {},
  load: async () => {
    if (get().loaded) return
    if (!checkIsTauri()) {
      set({ loaded: true })
      return
    }
    loadPromise ??= (async () => {
      try {
        const store = await getStore()
        const [pinned, favorites] = await Promise.all([store.get<unknown>('pinned'), store.get<unknown>('favorites')])
        set({ pinned: validMarks(pinned), favorites: validMarks(favorites), loaded: true })
      } catch (error) {
        console.error('Failed to load note marks:', error)
        set({ loaded: true })
      }
    })().finally(() => { loadPromise = null })
    await loadPromise
  },
  toggle: async (kind, workspaceKey, path) => {
    await get().load()
    const current = get()[kind]
    const next = { ...current, [workspaceKey]: toggleMarkedPath(current[workspaceKey] ?? EMPTY, path) }
    set({ [kind]: next } as Pick<NoteMarksState, NoteMarkKind>)
    await save(get().pinned, get().favorites)
  },
}))

/** 目前工作區的清單（未載入或沒有時回傳同一個空陣列，selector 不會每次都換新值）。 */
export function selectWorkspaceMarks(state: NoteMarksState, kind: NoteMarkKind, workspaceKey: string): readonly string[] {
  return state[kind][workspaceKey] ?? EMPTY
}

export function currentNoteMarksWorkspaceKey(): string {
  return noteMarksWorkspaceKey(useSettingStore.getState().workspacePath)
}

/** 改名、搬移、刪除時更新目前工作區的兩份清單；沒有變動就不寫檔。 */
function updateCurrentWorkspace(update: (list: readonly string[]) => string[]) {
  const state = useNoteMarksStore.getState()
  if (!state.loaded) return
  const key = currentNoteMarksWorkspaceKey()
  const changed: Partial<Pick<NoteMarksState, NoteMarkKind>> = {}
  for (const kind of ['pinned', 'favorites'] as const) {
    const list = state[kind][key]
    if (!list?.length) continue
    const next = update(list)
    if (next.length !== list.length || next.some((item, index) => item !== list[index])) {
      changed[kind] = { ...state[kind], [key]: next }
    }
  }
  if (!changed.pinned && !changed.favorites) return
  useNoteMarksStore.setState(changed)
  const latest = useNoteMarksStore.getState()
  void save(latest.pinned, latest.favorites).catch(error => console.error('Failed to save note marks:', error))
}

if (typeof window !== 'undefined') {
  emitter.on('editor-navigation-path-moved', event => {
    updateCurrentWorkspace(list => moveMarkedPaths(list, event.oldPath, event.newPath))
  })
  emitter.on('editor-navigation-path-deleted', event => {
    updateCurrentWorkspace(list => removeMarkedPaths(list, event.path, event.isFolder))
  })
}

export default useNoteMarksStore
