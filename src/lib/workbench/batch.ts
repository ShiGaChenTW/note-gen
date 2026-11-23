// Fork（almanac ALMNC-65.2）：同一則資料源拆出的多則新知識筆記，在工作台合成一張批次卡。純函式、無 I/O。
// 合批只是畫面上的分組（投影）：提案還是一則一則存在收集 store，接受、退回、修改都回頭改各自那一則；
// 其他類型的提案不合批，同一資料源只有一則時照原本的單卡顯示。
import type { DecideItem } from '@/lib/decide/project'

/** 可以合批的提案：收集來的新增知識筆記、帶著資料源；只貼日誌標籤的卡、指定了卡片的（清理、確認、回顧）、改既有檔案的都不算。 */
export function isBatchableNewNote(item: DecideItem): boolean {
  return item.source === 'collect'
    && item.status === 'wait'
    && item.kind === 'note'
    && item.preview.type === 'newNote'
    && item.noteType === 'knowledge'
    && !item.card
    && !item.journalTag?.only
    && Boolean(item.sourceIds?.length)
}

/** 同一資料源的比對鍵：資料源 id 去重排序後串起來（目前指揮官的提案都只帶一個資料源）。 */
export function sourceBatchKey(item: Pick<DecideItem, 'sourceIds'>): string {
  return Array.from(new Set(item.sourceIds ?? [])).sort().join('\u0000')
}

export type ProposalEntry =
  | { type: 'single', item: DecideItem }
  | { type: 'batch', key: string, items: DecideItem[] }

/**
 * 把提案清單分組：同一資料源、兩則以上的新知識筆記合成一組，放在那組第一則原本的位置；
 * 其他提案（含只有一則的）維持單則、維持原順序。
 */
export function batchProposals(items: readonly DecideItem[]): ProposalEntry[] {
  const groups = new Map<string, DecideItem[]>()
  for (const item of items) {
    if (!isBatchableNewNote(item)) continue
    const key = sourceBatchKey(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  const out: ProposalEntry[] = []
  const placed = new Set<string>()
  for (const item of items) {
    const key = isBatchableNewNote(item) ? sourceBatchKey(item) : null
    const group = key === null ? undefined : groups.get(key)
    if (key === null || !group || group.length < 2) {
      out.push({ type: 'single', item })
      continue
    }
    if (placed.has(key)) continue
    placed.add(key)
    out.push({ type: 'batch', key, items: group })
  }
  return out
}

export interface EachOutcome<Item, Value> {
  accepted: Array<{ item: Item, value: Value }>
  failed: Array<{ item: Item, error: unknown }>
}

/** 整批接受：一則一則照順序做，某一則失敗不影響其他則，最後回報哪些成功、哪些失敗。 */
export async function acceptEach<Item, Value>(items: readonly Item[], acceptOne: (item: Item) => Promise<Value>): Promise<EachOutcome<Item, Value>> {
  const outcome: EachOutcome<Item, Value> = { accepted: [], failed: [] }
  for (const item of items) {
    try {
      outcome.accepted.push({ item, value: await acceptOne(item) })
    } catch (error) {
      outcome.failed.push({ item, error })
    }
  }
  return outcome
}
