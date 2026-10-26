// Fork（#53）：提示詞庫頁的顯示狀態與使用紀錄。做法同 Inbox 頁：同一時間只開一個全頁覆蓋層。
import { create } from 'zustand'
import { getPromptUsageMap, recordPromptUsage, type PromptUsage } from '@/db/prompt-usage'
import { type PromptSort } from '@/lib/prompt-library/prompt-note'
import useHomeStore from './home'
import useInboxStore from './inbox'

interface PromptLibraryState {
  visible: boolean
  usage: Map<string, PromptUsage>
  loaded: boolean
  search: string
  tagFilter: string | null
  sort: PromptSort
  selectedPath: string | null
  show: (options?: { selectPath?: string }) => void
  hide: () => void
  refreshUsage: () => Promise<void>
  recordUsage: (path: string) => Promise<void>
  setSearch: (value: string) => void
  setTagFilter: (tag: string | null) => void
  setSort: (sort: PromptSort) => void
  setSelectedPath: (path: string | null) => void
}

const usePromptLibraryStore = create<PromptLibraryState>((set, get) => ({
  visible: false,
  usage: new Map(),
  loaded: false,
  search: '',
  tagFilter: null,
  sort: 'recentlyUsed',
  selectedPath: null,

  show: options => {
    useHomeStore.getState().hide()
    useInboxStore.getState().hide()
    set(state => ({ visible: true, selectedPath: options?.selectPath ?? state.selectedPath }))
    void get().refreshUsage()
  },
  hide: () => set({ visible: false }),

  refreshUsage: async () => {
    try {
      const usage = await getPromptUsageMap()
      set({ usage, loaded: true })
    } catch (error) {
      console.error('[prompt-library] failed to load usage:', error)
    }
  },
  recordUsage: async path => {
    await recordPromptUsage(path)
    await get().refreshUsage()
  },

  setSearch: value => set({ search: value }),
  setTagFilter: tag => set({ tagFilter: tag }),
  setSort: sort => set({ sort }),
  setSelectedPath: path => set({ selectedPath: path }),
}))

// 首頁或 Inbox 打開時收起提示詞庫頁（同一時間只留一個全頁覆蓋層）。
useHomeStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) usePromptLibraryStore.getState().hide()
})
useInboxStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) usePromptLibraryStore.getState().hide()
})

export default usePromptLibraryStore
