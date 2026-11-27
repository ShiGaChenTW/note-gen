// Fork（almanac ALMNC-85.2 骨架）：記憶體遠端（Map<路徑, 內容>），實作條件寫入模擬 Git 的 sha 檢查。
// 給雙裝置模擬測試用（設計 5.2 第二層），也可以給 E2E 的 mock 參考。
import { hashString } from './hash'
import { AlmanacRemoteConflictError, type AlmanacRemote } from './remote'

export interface MemoryRemoteFile {
  content: string
  version: string
}

export interface MemoryRemote extends AlmanacRemote {
  files: Map<string, MemoryRemoteFile>
  writes: string[]
  /** 下一次寫入這個路徑之前先執行（模擬另一台搶先寫入） */
  beforeNextWrite(path: string, action: () => void): void
}

export function createMemoryRemote(files = new Map<string, MemoryRemoteFile>()): MemoryRemote {
  let counter = 0
  const hooks = new Map<string, () => void>()
  const writes: string[] = []
  return {
    files,
    writes,
    beforeNextWrite(path, action) {
      hooks.set(path, action)
    },
    async read(path) {
      const file = files.get(path)
      return file ? { content: file.content, version: file.version } : null
    },
    async write(path, content, guard) {
      const hook = hooks.get(path)
      if (hook) {
        hooks.delete(path)
        hook()
      }
      const current = files.get(path)
      if ((current?.version ?? null) !== guard.version) throw new AlmanacRemoteConflictError(path)
      const version = `${hashString(content).slice(0, 8)}-${++counter}`
      files.set(path, { content, version })
      writes.push(path)
      return { version }
    },
  }
}
