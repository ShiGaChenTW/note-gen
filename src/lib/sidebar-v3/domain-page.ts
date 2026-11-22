// Fork（almanac ALMNC-54.23）：整理頁的「領域」分頁目前看的是哪個領域；從別處（例如筆記的領域標籤）直接開到某個領域也走這裡。
import { create } from 'zustand'
import { useKnowledgeOverlay } from './knowledge'

interface DomainPage {
  /** 正在看的領域 id；null＝領域清單。 */
  domainId: string | null
  open: (domainId: string | null) => void
}

export const useDomainPage = create<DomainPage>((set) => ({
  domainId: null,
  open: domainId => set({ domainId }),
}))

export const KNOWLEDGE_DOMAINS_TAB = 'domains'

/** 開整理頁的領域分頁；帶 id 就直接看那個領域。只在 V3 開得起來（show 本身會檢查）。 */
export function showDomainPage(domainId: string | null = null): void {
  useDomainPage.getState().open(domainId)
  useKnowledgeOverlay.getState().show(KNOWLEDGE_DOMAINS_TAB)
}
