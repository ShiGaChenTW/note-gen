// Fork（almanac ALMNC-69.9）：測試用的記憶體版 ops I/O——檔案放在一個物件裡、系統索引是一張 Map、ops 表是一個陣列。
// 寫檔照協調寫入的規則：目前內容和 before 不同就丟例外，不覆蓋。store 的資料可以交給另一個 store（模擬重開 App）。
import type { OpsFs, OpsWriter } from './execute'
import type { OpsStore } from './service'
import type { OpRecord } from './types'

export class MemoryWriteConflict extends Error {
  constructor(readonly path: string) { super(`conflict: ${path}`) }
}

export interface MemoryOpsIo {
  files: Record<string, string>
  ids: Map<string, string>
  fs: OpsFs
  writer: OpsWriter
}

export function createMemoryOpsIo(files: Record<string, string>, ids: Record<string, string> = {}): MemoryOpsIo {
  const index = new Map(Object.entries(ids))
  let counter = 0
  const current = (path: string) => files[path] ?? null
  return {
    files,
    ids: index,
    fs: {
      read: async path => current(path),
      resolveId: async id => index.get(id) ?? null,
      paths: async () => Object.keys(files),
      newId: async kind => `${kind}-20261123-1200${String(counter++).padStart(2, '0')}-UNDO`,
    },
    writer: {
      write: async (path, before, after) => {
        if (current(path) !== before) throw new MemoryWriteConflict(path)
        if (after === null) Reflect.deleteProperty(files, path)
        else files[path] = after
      },
      move: async (from, to) => {
        const content = current(from)
        if (content === null || current(to) !== null) throw new MemoryWriteConflict(to)
        files[to] = content
        Reflect.deleteProperty(files, from)
        for (const [id, path] of index) if (path === from) index.set(id, to)
      },
    },
  }
}

/** 記憶體版 ops 表；rows 可以交給下一個 store（同一份資料、重新載入）。存取時一律複製，模擬從資料庫讀回。 */
export function createMemoryOpsStore(rows: OpRecord[] = []): OpsStore & { rows: OpRecord[] } {
  const copy = (record: OpRecord): OpRecord => JSON.parse(JSON.stringify(record))
  let seq = rows.reduce((max, row) => Math.max(max, row.seq), 0)
  return {
    rows,
    insert: async records => {
      const saved = records.map(record => ({ ...copy({ ...record, seq: 0 }), seq: ++seq }))
      rows.push(...saved)
      return saved.map(copy)
    },
    get: async id => {
      const row = rows.find(item => item.id === id)
      return row ? copy(row) : null
    },
    listBatch: async batchId => rows.filter(row => row.batchId === batchId).map(copy),
    getMany: async ids => rows.filter(row => ids.includes(row.id)).map(copy),
    markUndone: async (ids, at) => {
      for (const row of rows) if (ids.includes(row.id)) row.undoneAt = at
    },
    prune: async before => {
      const keep = rows.filter(row => row.at >= before)
      const removed = rows.length - keep.length
      rows.splice(0, rows.length, ...keep)
      return removed
    },
  }
}
