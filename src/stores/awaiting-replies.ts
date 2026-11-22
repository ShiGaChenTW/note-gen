// Fork（almanac ALMNC-54.21）：「等你回話」的狀態（規則在 lib/threads/awaiting.ts）。
// 右側欄執行記一筆（mark）、ask_user_question 結束時拿掉（clear）；Scott 在那段對話送出訊息就自動拿掉（下面訂閱 useChatStore）。
import { create } from 'zustand'
import {
  clearAwaiting, dropAnswered, loadAwaiting, markAwaiting, saveAwaiting, type AwaitingMap, type AwaitingReply,
} from '@/lib/threads/awaiting'
import useChatStore from './chat'

interface AwaitingRepliesState {
  map: AwaitingMap
  hydrate: () => Promise<void>
  mark: (entry: AwaitingReply) => void
  clear: (conversationId: number, via?: AwaitingReply['via']) => void
}

let hydration: Promise<void> | undefined
let ready = false

const useAwaitingRepliesStore = create<AwaitingRepliesState>((set, get) => ({
  map: {},
  hydrate: () => hydration ??= loadAwaiting()
    .then(restored => {
      // 讀檔前就記的（這次啟動的）優先；合併後存一次，讀檔前記的才不會只在記憶體裡。
      ready = true
      set(state => ({ map: dropAnswered({ ...restored, ...state.map }, useChatStore.getState().chats) }))
    })
    .catch(error => {
      hydration = undefined
      console.debug('[awaiting] restore skipped:', error)
    }),
  mark: entry => {
    void get().hydrate()
    set(state => ({ map: markAwaiting(state.map, entry) }))
  },
  clear: (conversationId, via) => set(state => ({ map: clearAwaiting(state.map, conversationId, via) })),
}))

useAwaitingRepliesStore.subscribe((state, previous) => {
  if (!ready || state.map === previous.map) return
  void saveAwaiting(state.map).then(ok => { if (!ok) console.debug('[awaiting] save skipped') })
})

// Scott 在有人等他的對話送出訊息＝回話了。
useChatStore.subscribe((state, previous) => {
  if (state.chats === previous.chats) return
  const store = useAwaitingRepliesStore.getState()
  if (!Object.keys(store.map).length) return
  const next = dropAnswered(store.map, state.chats)
  if (next !== store.map) useAwaitingRepliesStore.setState({ map: next })
})

export default useAwaitingRepliesStore
