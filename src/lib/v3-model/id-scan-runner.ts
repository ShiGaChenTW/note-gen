// Fork（almanac ALMNC-69.5）：掃描補號與斷鏈修復的 I/O 層。
// 從筆記庫索引（stores/vault-index）挑候選檔案 → 讀內容與建立時間 → planScan（純函式，id-scan.ts）→
// 逐檔經編輯器協調寫入（lib/daily/coordinated-write：開著的那篇以編輯器內容為準；內容在掃描後又被改過就跳過，下次再掃）→
// 寫入成功的才登記 id_index。由 app/core/main/id-scan/id-scan-service.tsx 在 App 啟動與檔案變動後呼叫。
import { readTextFile, stat } from '@tauri-apps/plugin-fs'
import { commitNoteWrites } from '@/lib/daily/coordinated-write'
import { getFilePathOptions } from '@/lib/workspace'
import { listIdIndex, recordId } from '@/db/id-index'
import useVaultIndexStore from '@/stores/vault-index'
import { planScan, scanCandidates, type ScanFile, type ScanPlan } from './id-scan'

export interface IdScanResult {
  plan: ScanPlan
  /** 寫入失敗或衝突而跳過的檔案。 */
  skipped: string[]
}

function timeOf(value: Date | null | undefined): number | undefined {
  if (!value) return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

async function readScanFile(path: string): Promise<ScanFile | null> {
  const options = await getFilePathOptions(path)
  const fsOptions = options.baseDir ? { baseDir: options.baseDir } : undefined
  try {
    const [raw, info] = await Promise.all([readTextFile(options.path, fsOptions), stat(options.path, fsOptions)])
    const birthtime = timeOf(info.birthtime)
    const mtime = timeOf(info.mtime)
    return { path, raw, ...(birthtime ? { birthtime } : {}), ...(mtime ? { mtime } : {}) }
  } catch {
    // 讀檔期間被刪除或改名；下次掃描再看
    return null
  }
}

/** 跑一次掃描並套用。筆記庫索引還沒準備好時回傳 null。 */
export async function runIdScan(now = Date.now()): Promise<IdScanResult | null> {
  const store = useVaultIndexStore.getState()
  if (store.status !== 'ready') return null
  const notes = [...store.notes.values()]
  const idIndex = await listIdIndex()
  const candidates = scanCandidates(notes, idIndex)
  const files: ScanFile[] = []
  for (const path of candidates) {
    const file = await readScanFile(path)
    if (file) files.push(file)
  }
  const plan = planScan({ files, paths: notes.map(note => note.path), idIndex }, { now })
  for (const warning of plan.warnings) console.warn('[id-scan]', warning)

  const skipped = new Set<string>()
  for (const write of plan.writes) {
    try {
      await commitNoteWrites([write], { requireExisting: true })
    } catch (error) {
      skipped.add(write.path)
      console.warn('[id-scan] 寫入跳過（下次掃描再處理）：', write.path, error)
    }
  }
  const relinkSkipped = plan.actions.some(action => action.type === 'relink' && skipped.has(action.path))
  for (const upsert of plan.index) {
    if (upsert.dependsOn && skipped.has(upsert.dependsOn)) continue
    if (upsert.afterRelink && relinkSkipped) continue
    try {
      await recordId({ id: upsert.id, kind: upsert.kind, path: upsert.path, name: upsert.name }, now)
    } catch (error) {
      console.error('[id-scan] 系統索引登記失敗：', upsert.id, error)
    }
  }
  if (skipped.size === 0) return { plan, skipped: [] }
  // 沒寫成的檔案不通知（動作沒有生效）。
  const actions = plan.actions.filter(action => {
    if (action.type === 'clock' || action.type === 'held') return true
    if (action.type === 'rename') return !relinkSkipped
    return !skipped.has(action.path)
  })
  return { plan: { ...plan, actions }, skipped: [...skipped] }
}
