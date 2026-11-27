// Fork（almanac ALMNC-85.2 骨架）：記憶體遠端（Map<路徑, 內容>），實作條件寫入模擬 Git 的 sha 檢查。
// 給雙裝置模擬測試用（設計 5.2 第二層），也可以給 E2E 的 mock 參考。
// ALMNC-85.5：`conditional: false` 模擬不支援條件寫入的雲端資料夾（OneDrive 以外）——guard 一律忽略、直接覆寫；
// hook 可以是 async，用來讓兩台在同一輪裡交錯讀寫。
import { hashString } from './hash'
import { AlmanacRemoteConflictError, type AlmanacRemote } from './remote'

export interface MemoryRemoteFile {
  content: string
  version: string
}

type WriteHook = () => void | Promise<void>

export interface MemoryRemote extends AlmanacRemote {
  files: Map<string, MemoryRemoteFile>
  writes: string[]
  /** 下一次寫入這個路徑之前先執行（模擬另一台搶先寫入） */
  beforeNextWrite(path: string, action: WriteHook): void
  /** 下一次寫入這個路徑之後執行（模擬另一台緊接著寫入） */
  afterNextWrite(path: string, action: WriteHook): void
  /** 下一次讀這個路徑之後、回傳之前執行（模擬「這台讀完之後，另一台跑了一整輪」） */
  afterNextRead(path: string, action: WriteHook): void
}

export interface MemoryRemoteOptions {
  /** 預設 true；false＝不支援條件寫入（雲端資料夾），後寫的直接蓋掉先寫的 */
  conditional?: boolean
}

export function createMemoryRemote(files = new Map<string, MemoryRemoteFile>(), options: MemoryRemoteOptions = {}): MemoryRemote {
  const conditional = options.conditional !== false
  let counter = 0
  const before = new Map<string, WriteHook>()
  const after = new Map<string, WriteHook>()
  const afterRead = new Map<string, WriteHook>()
  const writes: string[] = []
  const take = (hooks: Map<string, WriteHook>, path: string) => {
    const hook = hooks.get(path)
    if (hook) hooks.delete(path)
    return hook
  }
  return {
    files,
    writes,
    beforeNextWrite(path, action) {
      before.set(path, action)
    },
    afterNextWrite(path, action) {
      after.set(path, action)
    },
    afterNextRead(path, action) {
      afterRead.set(path, action)
    },
    async read(path) {
      const file = files.get(path)
      const result = file ? { content: file.content, version: file.version } : null
      await take(afterRead, path)?.()
      return result
    },
    async write(path, content, guard) {
      await take(before, path)?.()
      const current = files.get(path)
      if (conditional && (current?.version ?? null) !== guard.version) throw new AlmanacRemoteConflictError(path)
      const version = `${hashString(content).slice(0, 8)}-${++counter}`
      files.set(path, { content, version })
      writes.push(path)
      await take(after, path)?.()
      return { version }
    },
  }
}
