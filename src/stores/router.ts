// Fork（almanac ALMNC-54.11）：右側欄送出前「問 Scott」的狀態——要交給誰（四個去處）、問哪位專家、要不要存成偏好。
// 送出流程（chat-send.tsx）打開提問並給一個 handler；輸入框上方的 RouteChooser 顯示選項，Scott 選了就交給 handler。
import { create } from 'zustand'
import type { Route } from '@/lib/router/router'
import type { SidebarRoutePlan } from '@/lib/router/sidebar'

export type RouterAnswer =
  | { kind: 'route', route: Route }
  | { kind: 'expert', agentId: string }
  | { kind: 'savePreference' }
  /** 不是偏好：當成一般指令交給指揮官。 */
  | { kind: 'notPreference' }
  | { kind: 'cancel' }

export interface RouterPrompt {
  id: number
  plan: Exclude<SidebarRoutePlan, { kind: 'run' }>
}

interface RouterState {
  prompt: RouterPrompt | null
  /** 打開提問；之前沒回答的提問直接取代（當成取消）。 */
  ask: (plan: RouterPrompt['plan'], onAnswer: (answer: RouterAnswer) => void) => void
  answer: (answer: RouterAnswer) => void
}

let handler: ((answer: RouterAnswer) => void) | null = null
let counter = 0

const useRouterStore = create<RouterState>((set, get) => ({
  prompt: null,
  ask: (plan, onAnswer) => {
    const previous = handler
    handler = onAnswer
    counter += 1
    set({ prompt: { id: counter, plan } })
    previous?.({ kind: 'cancel' })
  },
  answer: answer => {
    if (!get().prompt) return
    const current = handler
    handler = null
    set({ prompt: null })
    current?.(answer)
  },
}))

export default useRouterStore
