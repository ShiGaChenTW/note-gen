// Fork（almanac ALMNC-69.7）：MOC 流程（service.ts）的 App I/O：筆記庫索引找 MOC 與筆記、Tauri 讀檔、編輯器協調寫入、
// note.db 的 domains 表與系統索引。寫入端（檯面歸入領域、提案、領域提案、超過上限卡）與 MocRebuildService 都經過這裡。
import { commitNoteWrites } from '@/lib/daily/coordinated-write'
import { readNote, removeNote, writeNote } from '@/lib/daily/note-io'
import { newId } from '@/lib/v3-model/identity'
import useMocStore from '@/stores/moc'
import useVaultIndexStore from '@/stores/vault-index'
import { assignToMocs, rebuildFromMocs, removeFromMoc, type AssignRequest, type AssignResult, type MocIo, type RebuildOptions, type RebuildResult, type RemoveResult } from './service'

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).trim()).filter(Boolean)
}

function isMocFrontmatter(frontmatter: Record<string, unknown> | null): boolean {
  return typeof frontmatter?.kind === 'string' && frontmatter.kind.trim().toLowerCase() === 'domain'
}

export function createMocIo(): MocIo {
  return {
    listMocFiles: async (extra = []) => {
      const notes = useVaultIndexStore.getState().notes
      const paths = new Set([...[...notes.values()].filter(note => isMocFrontmatter(note.frontmatter)).map(note => note.path), ...extra])
      const files = []
      for (const path of paths) {
        const raw = await readNote(path).catch(() => null)
        if (raw !== null) files.push({ path, raw })
      }
      return files
    },
    listNotes: async () => [...useVaultIndexStore.getState().notes.values()]
      .filter(note => note.frontmatter && !isMocFrontmatter(note.frontmatter))
      .map(note => ({ path: note.path, domains: strings(note.frontmatter?.domains) })),
    paths: () => [...useVaultIndexStore.getState().notes.keys()],
    readFile: path => readNote(path),
    commit: async writes => {
      const done = []
      for (const write of writes) {
        try {
          done.push(...await commitNoteWrites([write], { requireExisting: true }))
        } catch (error) {
          console.warn('[moc] 寫入跳過（下次再處理）：', write.path, error)
        }
      }
      return done
    },
    createFile: (path, content) => writeNote(path, content, { createNew: true }),
    removeFile: path => removeNote(path),
    domainNames: async () => {
      const { listDomains } = await import('@/db/v3-domains')
      const map = new Map<string, string>()
      for (const domain of await listDomains()) {
        map.set(domain.id, domain.name.trim())
        if (!map.has(domain.name.trim())) map.set(domain.name.trim(), domain.name.trim())
      }
      return map
    },
    newId: async kind => {
      const { idExists } = await import('@/db/id-index')
      return newId(kind, new Date(), { exists: idExists })
    },
    recordMoc: async ({ id, path, name }) => {
      const { recordId } = await import('@/db/id-index')
      await recordId({ id, kind: 'M', path, name })
    },
  }
}

/** 重建後的共同收尾：更新快取（領域頁、工作台）、domains 表由 MOC 同步。 */
async function settle(result: RebuildResult): Promise<void> {
  useMocStore.getState().setResult({ mocs: result.mocs, overLimit: result.overLimit })
  try {
    const { syncDomainsTableFromMocs } = await import('@/db/v3-domains')
    const plan = await syncDomainsTableFromMocs(result.mocs)
    if (plan.skipped.length) console.debug('[moc] 還沒有 M 編號的 MOC，domains 表下次再補：', plan.skipped)
  } catch (error) {
    console.warn('[moc] domains 表同步失敗：', error)
  }
}

/** 由 MOC 重建全部筆記的 domains。筆記庫索引還沒準備好時回傳 null。 */
export async function runMocRebuild(options: RebuildOptions = {}): Promise<RebuildResult | null> {
  if (useVaultIndexStore.getState().status !== 'ready') return null
  const result = await rebuildFromMocs(createMocIo(), options)
  await settle(result)
  return result
}

/** 把筆記收進領域的 MOC（尚未分章），再重建 domains。domains 是領域名稱或舊 dom_ id，依序（第一個是主要）。 */
export async function assignNoteToDomains(notePath: string, domains: readonly string[]): Promise<AssignResult | null> {
  const requests: AssignRequest[] = domains.map(domain => ({ notePath, domain }))
  if (!requests.length) return null
  const result = await assignToMocs(createMocIo(), requests)
  await settle(result.rebuild)
  if (result.failed.length) console.warn('[moc] 沒有收進 MOC：', result.failed)
  return result
}

/** 超過上限卡：拿掉這則筆記在這個領域 MOC 的收錄。 */
export async function removeNoteFromDomain(notePath: string, domainName: string): Promise<RemoveResult> {
  const result = await removeFromMoc(createMocIo(), notePath, domainName)
  if (result.rebuild) await settle(result.rebuild)
  return result
}
