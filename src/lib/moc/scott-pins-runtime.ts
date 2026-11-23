// Fork（almanac ALMNC-69.11）：「Scott 指定」標記的 App 接線（I/O）。判斷在 scott-pins.ts／scott-pin-check.ts（純函式、有測試）。
// - 儲存：registerScottPinStorage() 把 note.db 的 scott_pins 註冊給 69.10 的 recordScottPins（MocRebuildService 啟動時呼叫）。
//   Obsidian 手動編輯（reconcile-runtime）與 App 內 actor＝scott 的 ops（ops/runtime 記錄後）都經 recordScottPins 存下來。
// - 讀取：loadScottPins() 回傳有效的標記（90 天內），同時更新 stores/scott-pins 給畫面用。
// - 自動接受：isScottPinnedChange()（65.3 的 isScottPinned 接這裡）。
// - 每週整理：weekly-moc 的 pins 依賴用 loadScottPins＋vaultPinResolver。
import type { ContentChange } from '@/lib/workbench/risk'
import useScottPinsStore from '@/stores/scott-pins'
import { parseMoc } from './parse'
import { changesPinTouches, type PinNoteResolver } from './scott-pin-check'
import { registerScottPinRecorder, type ScottPin } from './scott-pins'

async function workspacePath(): Promise<string> {
  const { default: useSettingStore } = await import('@/stores/setting')
  return useSettingStore.getState().workspacePath ?? ''
}

/** 有效的標記（並更新畫面用的快取）。讀不到資料庫時回傳空陣列（不擋原本的流程）。 */
export async function loadScottPins(now = Date.now()): Promise<ScottPin[]> {
  try {
    const [workspace, { scottPinStore }] = await Promise.all([workspacePath(), import('@/db/scott-pins')])
    const pins = await scottPinStore.active(now)
    if (await workspacePath() === workspace) useScottPinsStore.getState().setPins(workspace, pins)
    return pins
  } catch (error) {
    console.debug('[moc] Scott 指定標記讀不到：', error)
    return []
  }
}

let registered = false

/** App 啟動時註冊標記的儲存（重複呼叫沒事）。之後順便載入一次給畫面用。 */
export function registerScottPinStorage(): void {
  if (!registered) {
    registered = true
    registerScottPinRecorder(async pins => {
      const { scottPinStore } = await import('@/db/scott-pins')
      await scottPinStore.save(pins)
      await loadScottPins()
    })
  }
  void loadScottPins()
}

/** 用筆記庫索引解析收錄行的連結：路徑＋frontmatter 的 N 編號。 */
export async function vaultPinResolver(): Promise<PinNoteResolver> {
  const [{ default: useVaultIndexStore }, { buildLinkLookup, resolveWikilinkTargetWithLookup }] = await Promise.all([
    import('@/stores/vault-index'), import('@/lib/vault-index/links'),
  ])
  const notes = useVaultIndexStore.getState().notes
  const lookup = buildLinkLookup(notes.keys())
  return (target, mocPath) => {
    const path = resolveWikilinkTargetWithLookup(target, lookup, mocPath)
    if (!path || !notes.has(path)) return null
    const id = notes.get(path)?.frontmatter?.id
    return typeof id === 'string' && id.trim() ? { path, id: id.trim() } : { path }
  }
}

/**
 * 65.3 自動接受前的檢查：這份改動碰到有效的 Scott 指定位置（例如 MOC 上有標記的收錄或區塊）就不自動接受。
 * 讀不到標記時丟錯（tryAutoAcceptLink 接住後改成照一般提案送審，不冒險自動接受）。
 */
export async function isScottPinnedChange(change: Readonly<ContentChange>): Promise<boolean> {
  // 標記只在 MOC 上：改的不是原本就存在的 MOC 就碰不到標記，不必讀資料庫。
  if (change.target !== 'note' || change.before === null || !parseMoc(change.before, change.path).isMoc) return false
  const { scottPinStore } = await import('@/db/scott-pins')
  const pins = await scottPinStore.active()
  if (!pins.length) return false
  return changesPinTouches([change], pins, { now: Date.now(), resolve: await vaultPinResolver() }).length > 0
}
