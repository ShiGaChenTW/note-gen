export type ExploreRequest =
  | { origin: 'conversation' | 'new-domain', topic: string }
  /** MOC 頁首「相鄰」那一行按「探索」：從這個 MOC 的相鄰領域出發。 */
  | { origin: 'adjacent', domainId: string, domainName: string, topics: string[], topic?: string }
  /** 未歸屬清單選筆記按「新增領域」：選中的筆記一定收進藍圖的章節。 */
  | { origin: 'unassigned', notePaths: string[] }

export type ExploreHandler = (request: ExploreRequest) => void | Promise<void>

let handler: ExploreHandler | null = null

/** 註冊探索的處理函式（ALMNC-69.13）；回傳取消註冊的函式。傳 null 清掉。 */
export function setExploreHandler(next: ExploreHandler | null): () => void {
  handler = next
  return () => { if (handler === next) handler = null }
}

/** 對話工具要等到提案確實建立，才向 Scott 回報。 */
export async function dispatchExplore(request: ExploreRequest): Promise<boolean> {
  if (!handler || (request.origin === 'unassigned' && !request.notePaths.length)) return false
  await handler(request)
  return true
}

/** 按鈕入口交給啟動時註冊的處理函式。 */
export function requestExplore(request: ExploreRequest): boolean {
  if (!handler || (request.origin === 'unassigned' && !request.notePaths.length)) return false
  void dispatchExplore(request).catch(error => console.warn('[explore] handler failed:', error))
  return true
}
