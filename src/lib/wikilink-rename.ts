/**
 * Phase 2-2 L7：改名改寫連結的 I/O 層。
 * `planLinkRewrite(moves)` 用索引篩候選、讀檔、跑純函式算出受影響的筆記與連結數；
 * `applyLinkRewrite(plan)` 透過 `rewriteNotes` 寫回（寫前會重讀最新內容再改寫一次）。
 * 掛載當下 watcher 可能還沒更新索引，所以候選用搬動前的路徑查索引、用搬動後的路徑讀檔。
 */

import { readNote } from '@/lib/daily/note-io'
import {
  collectLinkRewriteCandidates,
  mapMovedPath,
  normalizeMoves,
  rewriteLinksForMoves,
  unmapMovedPath,
  type PathMove,
} from '@/lib/markdown/wikilink-rewrite'
import { rewriteNotes, type RewrittenNote } from '@/lib/note-rewrite'
import useVaultIndexStore from '@/stores/vault-index'

export interface LinkRewriteFile {
  /** 搬動後的路徑（讀檔與寫回都用它） */
  path: string
  /** 這篇會改寫的連結數 */
  count: number
}

export interface LinkRewritePlan {
  files: LinkRewriteFile[]
  totalLinks: number
  moves: PathMove[]
  pathsBefore: string[]
  pathsAfter: string[]
}

const READ_CONCURRENCY = 8

async function mapConcurrently<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  }))
  return results
}

function rewriteFor(plan: Pick<LinkRewritePlan, 'moves' | 'pathsBefore' | 'pathsAfter'>, pathAfter: string) {
  return (content: string) => rewriteLinksForMoves({
    content,
    sourcePathBefore: unmapMovedPath(pathAfter, plan.moves),
    sourcePathAfter: pathAfter,
    moves: plan.moves,
    pathsBefore: plan.pathsBefore,
    pathsAfter: plan.pathsAfter,
  })
}

/** 算出要改寫的筆記清單；0 筆時 `files` 為空。不寫檔。 */
export async function planLinkRewrite(rawMoves: PathMove[]): Promise<LinkRewritePlan> {
  const moves = normalizeMoves(rawMoves)
  const empty: LinkRewritePlan = { files: [], totalLinks: 0, moves, pathsBefore: [], pathsAfter: [] }
  if (moves.length === 0) return empty

  const notes = useVaultIndexStore.getState().notes
  const pathsBefore = [...notes.keys()].map(path => unmapMovedPath(path, moves))
  const pathsAfter = pathsBefore.map(path => mapMovedPath(path, moves))
  const plan = { moves, pathsBefore, pathsAfter }
  const candidates = collectLinkRewriteCandidates(moves, notes.values()).map(path => mapMovedPath(path, moves))

  const files = await mapConcurrently(candidates, READ_CONCURRENCY, async (path): Promise<LinkRewriteFile | null> => {
    const content = await readNote(path)
    if (content === null) return null
    const { count } = rewriteFor(plan, path)(content)
    return count > 0 ? { path, count } : null
  })
  const kept = files.filter((file): file is LinkRewriteFile => file !== null)
  return { ...plan, files: kept, totalLinks: kept.reduce((sum, file) => sum + file.count, 0) }
}

/** 依計畫寫回；任一篇失敗整批還原並丟出錯誤（見 `rewriteNotes`）。 */
export async function applyLinkRewrite(plan: LinkRewritePlan): Promise<RewrittenNote[]> {
  if (plan.files.length === 0) return []
  return rewriteNotes(plan.files.map(file => ({
    path: file.path,
    rewrite: content => rewriteFor(plan, file.path)(content).content,
  })))
}
