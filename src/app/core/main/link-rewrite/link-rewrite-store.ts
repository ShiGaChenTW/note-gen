/**
 * Phase 2-2 L7：改名改寫連結的詢問佇列。
 * 上游的三個改名／搬動掛載點呼叫 `requestLinkRewrite(moves)`；它算出計畫後把請求放進這個 store，
 * `<LinkRewritePrompt />`（掛在 fork-services.tsx）顯示 AlertDialog，使用者決定後 resolve。
 * 這個函式永遠不丟錯：改名已經成功，連結改寫只是附加動作，不能觸發上游的 rollback。
 */

import { create } from 'zustand'
import type { PathMove } from '@/lib/markdown/wikilink-rewrite'
import { planLinkRewrite, type LinkRewritePlan } from '@/lib/wikilink-rename'

export interface LinkRewriteRequest {
  plan: LinkRewritePlan
  /** 對話框關閉（不論改寫與否、成功與否）時呼叫 */
  resolve: () => void
}

interface LinkRewriteState {
  /** 目前顯示中的請求；同時只處理一個 */
  request: LinkRewriteRequest | null
  /** `<LinkRewritePrompt />` 有掛載才會詢問；沒有時靜默略過 */
  promptMounted: boolean
  setPromptMounted: (mounted: boolean) => void
  enqueue: (request: LinkRewriteRequest) => void
  finish: () => void
}

const pending: LinkRewriteRequest[] = []

export const useLinkRewriteStore = create<LinkRewriteState>((set, get) => ({
  request: null,
  promptMounted: false,
  setPromptMounted: mounted => set({ promptMounted: mounted }),
  enqueue: request => {
    if (get().request) pending.push(request)
    else set({ request })
  },
  finish: () => {
    const current = get().request
    set({ request: pending.shift() ?? null })
    current?.resolve()
  },
}))

/**
 * 改名／搬動成功後呼叫：有受影響的連結時詢問使用者是否一併改寫，等到對話框關閉才 resolve。
 * 0 筆或沒有掛載詢問元件時靜默結束。
 */
export async function requestLinkRewrite(moves: PathMove[]): Promise<void> {
  try {
    const plan = await planLinkRewrite(moves)
    if (plan.files.length === 0) return
    const store = useLinkRewriteStore.getState()
    if (!store.promptMounted) return
    await new Promise<void>(resolve => store.enqueue({ plan, resolve }))
  } catch (error) {
    console.error('[link-rewrite] 計算受影響的連結失敗：', error)
  }
}
