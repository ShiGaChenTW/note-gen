// Fork（almanac ALMNC-10）：「等你定」頁的顯示狀態，加上今日日誌的讀取快取（只給預覽與去重用）。
// 這裡**沒有**待決項目的任何狀態：清單由 lib/decide/project.ts 從收集與任務中心現況投影。
import { create } from 'zustand'
import { useUiModeStore } from '@/lib/fork-ui'
import type { JournalSnapshot } from '@/lib/decide/project'
import { sameJournal } from '@/lib/decide/journal-refresh'
import useCollectStore from './collect'
import useHomeStore from './home'
import useInboxStore from './inbox'
import usePromptLibraryStore from './prompt-library'

interface DecideState {
  visible: boolean
  /** 目前選中的項目 key（右側詳情）。 */
  selected: string | null
  journal: JournalSnapshot | null
  show: () => void
  hide: () => void
  select: (key: string | null) => void
  setJournal: (journal: JournalSnapshot | null) => void
}

const useDecideStore = create<DecideState>(set => ({
  visible: false,
  selected: null,
  journal: null,
  show: () => {
    useHomeStore.getState().hide()
    useInboxStore.getState().hide()
    usePromptLibraryStore.getState().hide()
    useCollectStore.getState().hide()
    set({ visible: true })
  },
  hide: () => set({ visible: false }),
  select: key => set({ selected: key }),
  // Fork（almanac ALMNC-56.7，P06）：內容沒變就不更新，免得每次輪詢都重算提案、側欄徽章與今天頁。
  setJournal: journal => set(state => sameJournal(state.journal, journal) ? state : { journal }),
}))

// 其他全頁覆蓋層打開時收起；切回舊介面時也收起。
for (const store of [useHomeStore, useInboxStore, usePromptLibraryStore, useCollectStore]) {
  store.subscribe((state, previous) => {
    if ((state as { visible: boolean }).visible && !(previous as { visible: boolean }).visible) useDecideStore.getState().hide()
  })
}
useUiModeStore.subscribe((state) => {
  if (state.mode !== 'v3') useDecideStore.getState().hide()
})

export default useDecideStore
