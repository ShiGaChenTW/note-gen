// Fork（almanac ALMNC-69.7）：測試用的記憶體版 MocIo（service.ts 的 I/O）。檔案放在一個物件裡，協調寫入的行為照
// lib/daily/coordinated-write：內容等於 before 才寫 after，不同就試 rebase，套不上就略過。
import { readFrontmatter } from '@/lib/migration/id-migration'
import { parseV3Note } from '@/lib/v3-model/note'
import type { MocIo } from './service'

export interface MemoryMocIo extends MocIo {
  files: Record<string, string>
}

function isMoc(raw: string): boolean {
  const data = readFrontmatter(raw)
  return typeof data?.kind === 'string' && data.kind.trim().toLowerCase() === 'domain'
}

export function createMemoryMocIo(files: Record<string, string>, options: { domainNames?: Record<string, string>, folder?: string } = {}): MemoryMocIo {
  let counter = 0
  const io: MemoryMocIo = {
    files,
    listMocFiles: async (extra = []) => {
      const paths = new Set([...Object.keys(files).filter(path => isMoc(files[path])), ...extra])
      return [...paths].filter(path => files[path] !== undefined).map(path => ({ path, raw: files[path] }))
    },
    listNotes: async () => Object.keys(files).filter(path => !isMoc(files[path])).flatMap(path => {
      try {
        return [{ path, domains: parseV3Note(files[path]).fields.domains }]
      } catch {
        return []
      }
    }),
    paths: () => Object.keys(files),
    readFile: async path => files[path] ?? null,
    commit: async writes => {
      const done = []
      for (const write of writes) {
        const latest = files[write.path]
        if (latest === undefined) continue
        const after = latest === write.before ? write.after : write.rebase?.(latest) ?? null
        if (after === null) continue
        files[write.path] = after
        done.push({ path: write.path, before: latest, after })
      }
      return done
    },
    createFile: async (path, content) => {
      if (files[path] !== undefined) throw new Error(`exists: ${path}`)
      files[path] = content
    },
    removeFile: async path => {
      Reflect.deleteProperty(files, path)
    },
    domainNames: async () => new Map(Object.entries(options.domainNames ?? {})),
    newId: async kind => `${kind}-20261123-0000${String(counter++).padStart(2, '0')}-TEST`,
    ...(options.folder !== undefined ? { folder: options.folder } : {}),
  }
  return io
}
