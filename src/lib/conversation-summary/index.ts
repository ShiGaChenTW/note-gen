// Fork（#33）：產生與存檔對話摘要。直接依對話 id 從資料庫讀訊息，所以首頁也能觸發。
import { create } from 'zustand'
import { getChatsByConversation } from '@/db/chats'
import { getConversation } from '@/db/conversations'
import { fetchAi } from '@/lib/ai/chat'
import { readNote, writeNote } from '@/lib/daily/note-io'
import useVaultIndexStore from '@/stores/vault-index'
import {
  buildSummaryMessages,
  buildTranscript,
  collectReferencedPaths,
  conversationKey,
  findExistingSummary,
  parseSummaryJson,
  renderSummary,
  resolveRelated,
  summaryPath,
  type SummaryHeadings,
} from './model'

export interface SummaryTexts {
  headings: SummaryHeadings
  labels: { me: string; ai: string }
  language: string
}

export type SummaryErrorCode = 'empty' | 'parse' | 'notFound'

export class SummaryError extends Error {
  constructor(readonly code: SummaryErrorCode, readonly detail?: string) {
    super(code)
  }
}

export interface SummaryDraft {
  path: string
  content: string
  /** 已有同一對話的摘要時，它的路徑（會更新那一份）。 */
  existingPath: string | null
}

export async function generateSummary(conversationId: number, texts: SummaryTexts, now = new Date()): Promise<SummaryDraft> {
  const conversation = await getConversation(conversationId)
  if (!conversation) throw new SummaryError('notFound')
  const chats = await getChatsByConversation(conversationId)
  const transcript = buildTranscript(chats, texts.labels)
  if (!transcript) throw new SummaryError('empty')

  const raw = await fetchAi('', undefined, buildSummaryMessages(transcript, texts.labels, texts.language))
  const data = parseSummaryJson(raw)
  if (!data) throw new SummaryError('parse', raw.slice(0, 300))

  const notes = useVaultIndexStore.getState().notes
  const key = conversationKey(conversation)
  const existing = findExistingSummary(notes.values(), key)
  const related = resolveRelated(collectReferencedPaths(chats), data.related, [...notes.keys()])
  return {
    path: existing?.path ?? summaryPath(now, data.subject),
    content: renderSummary(data, { conversation: key, date: now, related }, texts.headings),
    existingPath: existing?.path ?? null,
  }
}

/** 存檔前檢查：路徑若已存在、又不是這個對話的摘要，就不覆蓋。 */
export async function saveSummary(draft: SummaryDraft): Promise<void> {
  const path = draft.path.trim().replace(/^\/+/, '')
  if (path !== draft.existingPath && (await readNote(path)) !== null) throw new Error(`EXISTS:${path}`)
  await writeNote(path, draft.content)
}

type Phase = 'idle' | 'loading' | 'ready' | 'saving' | 'error'

interface SummaryUiState {
  conversationId: number | null
  phase: Phase
  draft: SummaryDraft | null
  error: string | null
  open: (conversationId: number) => void
  close: () => void
  setPhase: (phase: Phase, patch?: Partial<Pick<SummaryUiState, 'draft' | 'error'>>) => void
  setDraft: (patch: Partial<SummaryDraft>) => void
}

export const useConversationSummaryStore = create<SummaryUiState>(set => ({
  conversationId: null,
  phase: 'idle',
  draft: null,
  error: null,
  open: conversationId => set({ conversationId, phase: 'loading', draft: null, error: null }),
  close: () => set({ conversationId: null, phase: 'idle', draft: null, error: null }),
  setPhase: (phase, patch) => set({ phase, ...patch }),
  setDraft: patch => set(state => (state.draft ? { draft: { ...state.draft, ...patch } } : {})),
}))

/** 從任何地方（對話標題列、首頁）打開摘要預覽。 */
export function openConversationSummary(conversationId: number) {
  useConversationSummaryStore.getState().open(conversationId)
}
