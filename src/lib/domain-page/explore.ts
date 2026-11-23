// Fork（almanac ALMNC-69.8）：「探索」的入口登記處。探索流程本身（指揮官查筆記庫 → 領域藍圖提案 → 探索中領域）是 ALMNC-69.13。
// 畫面上的入口（MOC 頁首「相鄰」旁的「探索」、整理 > 領域「未歸屬」清單的「新增領域」）一律呼叫 requestExplore；
// 69.13 在 App 啟動時用 setExploreHandler 註冊真正的處理函式即可接手，畫面不用改。
// 還沒有人註冊時 requestExplore 回傳 false，畫面顯示「探索功能即將推出」。
// 規格：almanac/2026-11-23_proposal_note-type-rules.md 第二節〈由 Scott 發起：探索〉第 1 步；GLOSSARY「探索」。

export type ExploreRequest =
  /** MOC 頁首「相鄰」那一行按「探索」：從這個 MOC 的相鄰領域出發。 */
  | { origin: 'adjacent', domainId: string, domainName: string, topics: string[] }
  /** 未歸屬清單選筆記按「新增領域」：選中的筆記一定收進藍圖的章節。 */
  | { origin: 'unassigned', notePaths: string[] }

export type ExploreHandler = (request: ExploreRequest) => void | Promise<void>

let handler: ExploreHandler | null = null

/** 註冊探索的處理函式（ALMNC-69.13）；回傳取消註冊的函式。傳 null 清掉。 */
export function setExploreHandler(next: ExploreHandler | null): () => void {
  handler = next
  return () => { if (handler === next) handler = null }
}

/** 有處理函式就交給它並回傳 true；還沒有（69.13 尚未接上）回傳 false，由畫面提示即將推出。 */
export function requestExplore(request: ExploreRequest): boolean {
  if (!handler) return false
  void Promise.resolve(handler(request)).catch(error => console.warn('[explore] handler failed:', error))
  return true
}
