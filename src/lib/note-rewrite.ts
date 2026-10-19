/**
 * Phase 2-2 共用：改寫 vault 內可能正在編輯器裡開著的筆記。
 *
 * 寫檔前後的細節全部照上游 `markdown-media-path.ts` 的做法：
 * 1. 透過 `runEditorPathWriteTransaction` 排隊，避免與編輯器的防抖存檔互相覆蓋；
 * 2. 寫入時重讀最新內容再改寫（讀到的才是真相，不信任呼叫端快取）；
 * 3. 目前開著的那篇，寫完要用 `editor-file-content-updated` 與 `external-content-update`
 *    通知分頁快取與編輯器重新載入；編輯器正忙或有排隊中的存檔時整批還原並回報失敗；
 * 4. 任一檔案失敗時，已寫過的檔案全部還原。
 *
 * L5 屬性面板與 L7 改名改寫連結都只呼叫 `rewriteNotes`，不要各自碰 Tauri fs。
 */

import emitter from '@/lib/emitter'
import {
  getEditorPathMutationRevision,
  markEditorPathMutation,
  prepareActiveEditorDeactivation,
  runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'
import { readNote, writeNote } from '@/lib/daily/note-io'
import useArticleStore from '@/stores/article'

export interface NoteRewrite {
  /** vault 相對路徑 */
  path: string
  /** 回傳新內容；回傳原字串或 null 代表這篇不用改 */
  rewrite: (content: string) => string | null
}

export interface RewrittenNote {
  path: string
  content: string
  previousContent: string
}

type Committed = RewrittenNote & { revision: number }

export class NoteRewriteConflictError extends Error {
  constructor(public readonly path: string) {
    super(`筆記在改寫期間被修改，已還原：${path}`)
    this.name = 'NoteRewriteConflictError'
  }
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

/**
 * 依序改寫多篇筆記；全部成功才算成功，否則還原已寫的檔案並丟出錯誤。
 * 回傳實際有改動的檔案（內容相同的會跳過）。
 */
export async function rewriteNotes(rewrites: NoteRewrite[]): Promise<RewrittenNote[]> {
  const activePath = normalizePath(useArticleStore.getState().activeFilePath)
  // 目前開著的那篇最後寫，讓編輯器的更新緊接在磁碟寫入之後
  const ordered = rewrites
    .map(item => ({ ...item, path: normalizePath(item.path) }))
    .filter(item => item.path)
    .sort((a, b) => Number(a.path === activePath) - Number(b.path === activePath))

  const written: Committed[] = []
  try {
    for (const item of ordered) {
      markEditorPathMutation(item.path)
      let committed: Committed | null = null
      const ok = await runEditorPathWriteTransaction(item.path, async ({ hasQueuedSave }) => {
        const article = useArticleStore.getState()
        const isActive = normalizePath(article.activeFilePath) === item.path
        const latest = isActive ? article.currentArticle : await readNote(item.path)
        if (latest === null) return true // 檔案不在了，當作不用改
        const next = item.rewrite(latest)
        if (next === null || next === latest) return true

        await writeNote(item.path, next)
        const editorIsStable = !isActive || prepareActiveEditorDeactivation()
        if (!editorIsStable || hasQueuedSave()) {
          await writeNote(item.path, latest)
          return false
        }
        markEditorPathMutation(item.path)
        committed = {
          path: item.path,
          content: next,
          previousContent: latest,
          revision: getEditorPathMutationRevision(item.path),
        }
        return true
      })
      if (!ok) throw new NoteRewriteConflictError(item.path)
      if (committed) written.push(committed)
    }
  } catch (error) {
    await Promise.allSettled(written.map(async update => {
      markEditorPathMutation(update.path)
      await runEditorPathWriteTransaction(update.path, async () => {
        if (await readNote(update.path) !== update.content) return false
        await writeNote(update.path, update.previousContent)
        markEditorPathMutation(update.path)
        return true
      })
    }))
    throw error
  }

  for (const update of written) {
    if (getEditorPathMutationRevision(update.path) !== update.revision) continue
    emitter.emit('editor-file-content-updated', { path: update.path, content: update.content })
    const article = useArticleStore.getState()
    if (normalizePath(article.activeFilePath) === update.path) {
      article.setCurrentArticle(update.content)
      emitter.emit('external-content-update', update.content)
    }
  }
  return written.map(({ path, content, previousContent }) => ({ path, content, previousContent }))
}

/** 單篇版本；沒改動時回傳 null。 */
export async function rewriteNote(path: string, rewrite: (content: string) => string | null): Promise<RewrittenNote | null> {
  const [result] = await rewriteNotes([{ path, rewrite }])
  return result ?? null
}
