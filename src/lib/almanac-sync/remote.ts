// Fork（almanac ALMNC-85.2 骨架）：V3 同步檔的遠端讀寫轉接（設計 1.1、5.1）。
// 帳號層 → 資料同步庫的 .data/almanac/（同 .data/marks.json）；筆記庫層 → 筆記庫遠端的 .almanac/v3/（同 84.8 的 .almanac/deletions.json）。
// Git 類（GitHub、Gitee、GitLab、Gitea）、S3、WebDAV、雲端資料夾都重用 remote-library 既有的讀寫函式；
// 自架同步走物件模型，另見 self-hosted.ts。

import type { CloudFolderConfig } from '@/types/sync'

export type AlmanacSyncLayer = 'account' | 'library'

export const ALMANAC_ACCOUNT_ROOT = '.data/almanac'
export const ALMANAC_LIBRARY_ROOT = '.almanac/v3'

export interface RemoteReadResult {
  content: string
  /** Git sha／S3、WebDAV etag；拿來做條件寫入。沒有版本資訊時是 null。 */
  version: string | null
}

/** null＝只在檔案不存在時建立；字串＝只取代這個版本。 */
export interface RemoteWriteGuard {
  version: string | null
}

export interface AlmanacRemote {
  /** 檔案不存在回 null；其他錯誤要丟出來（不能把讀取失敗當成「遠端是空的」） */
  read(path: string): Promise<RemoteReadResult | null>
  /** 條件寫入：遠端版本跟 guard 不同時丟 AlmanacRemoteConflictError，呼叫端重新拉、合併、再推 */
  write(path: string, content: string, guard: RemoteWriteGuard): Promise<{ version: string | null }>
}

export class AlmanacRemoteConflictError extends Error {
  constructor(path: string) {
    super(`SYNC_SWITCH_STALE: almanac ${path}`)
    this.name = 'AlmanacRemoteConflictError'
  }
}

export function isAlmanacRemoteConflict(error: unknown): boolean {
  if (error instanceof AlmanacRemoteConflictError) return true
  const message = error instanceof Error ? error.message : String(error)
  return /SYNC_SWITCH_STALE|\b409\b|\b412\b|does not match|sha.*(?:mismatch|wasn't supplied)/i.test(message)
}

export function remoteRootFor(layer: AlmanacSyncLayer): string {
  return layer === 'account' ? ALMANAC_ACCOUNT_ROOT : ALMANAC_LIBRARY_ROOT
}

// ---------- 不支援條件寫入的遠端：寫前比對＋寫後重讀（ALMNC-85.5） ----------

export const VERIFIED_WRITE_SETTLE_MS = 150

export interface VerifiedWriteOptions {
  /** 寫入後等多久再讀回比對；涵蓋「兩台在約 100ms 內寫同一檔」 */
  settleMs?: number
  sleep?: (ms: number) => Promise<void>
}

/**
 * 雲端資料夾（OneDrive 以外）沒有條件寫入：兩台在同一輪各自讀到舊版、各自寫回時，後寫的會整份蓋掉先寫的。
 * 先寫那台已經把基準更新成自己寫的內容，下一輪看到遠端少了自己的修改，會當成「別台改回去」而採用遠端——修改就永久不見了
 * （engine.test 的雲端資料夾競態測試重現過）。
 *
 * 這裡在 TS 端模擬條件寫入，不改 Rust：
 * 1. 寫前比對：重讀一次，內容跟這台上次讀到的不同 → 丟 AlmanacRemoteConflictError（engine 會重拉重合併，基準還沒動）。
 * 2. 寫後重讀：等 settleMs 再讀回，內容不是自己寫的（別台在這段時間寫了）→ 一樣丟衝突，下一次重試會把對方的版本合併進來再寫。
 * 寫後重讀失敗時 engine 還沒更新基準，重試會把自己的修改連同對方的一起再寫一次。
 * 剩下的窗口：別台通過寫前比對之後、真正寫入之前（一次本機檔案寫入的時間），這台要完成「寫入＋等 settleMs＋讀回」整段，
 * 兩台在 100ms 內交錯寫的情況都落在上面兩道檢查裡；要完全關閉只能靠真正的條件寫入（需要 Rust 端 etag 比對）。
 */
export function withVerifiedWrites(remote: AlmanacRemote, options: VerifiedWriteOptions = {}): AlmanacRemote {
  const settleMs = options.settleMs ?? VERIFIED_WRITE_SETTLE_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  /** 這台最近一次讀到的內容（null＝檔案不存在），寫前比對用 */
  const lastSeen = new Map<string, string | null>()
  return {
    async read(path) {
      const result = await remote.read(path)
      lastSeen.set(path, result?.content ?? null)
      return result
    },
    async write(path, content, guard) {
      const before = await remote.read(path)
      const expected = lastSeen.has(path) ? lastSeen.get(path) ?? null : undefined
      const changed = expected === undefined
        ? (before?.version ?? null) !== guard.version
        : (before?.content ?? null) !== expected
      if (changed) {
        lastSeen.set(path, before?.content ?? null)
        throw new AlmanacRemoteConflictError(path)
      }
      const written = await remote.write(path, content, guard)
      if (settleMs > 0) await sleep(settleMs)
      const after = await remote.read(path)
      lastSeen.set(path, after?.content ?? null)
      if ((after?.content ?? null) !== content) throw new AlmanacRemoteConflictError(path)
      return { version: after?.version ?? written.version }
    },
  }
}

// ---------- 正式轉接：重用 remote-library ----------

type Platform = 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder'

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\b404\b|not\s*found|no such file|does not exist|不存在|NoSuchKey|SYNC_DATA_EMPTY/i.test(message)
}

/**
 * 遠端讀寫用哪個範圍：帳號層一律是資料同步庫（'data'），筆記庫層原則上是筆記庫遠端（'workspace'）。
 *
 * 例外（ALMNC-95.3 E2E 抓到）：桌面版的雲端資料夾（非 OneDrive、非 Android）沒有「筆記庫遠端」——筆記庫本身就放在雲端資料夾裡，
 * 由 iCloud Drive 這類 App 外的同步搬檔，remote-library 的 'workspace' 讀寫在這裡一律失敗（「云盘文件夹上传失败」），
 * 整輪 V3 同步因此在 ops 表中斷，連帶 meta.json 不更新、另一台收不到。這種情況筆記庫層改放在同步資料夾裡
 * （<資料夾>/.notegen/sync-v1/.almanac/v3/，跟 .data/ 同一層、不在筆記庫裡），一個雲端資料夾只對應一個筆記庫，不會混到別的筆記庫。
 */
export async function resolveAlmanacRemoteScope(
  layer: AlmanacSyncLayer,
  cloudFolder: CloudFolderConfig | null,
): Promise<'data' | 'workspace'> {
  if (layer === 'account') return 'data'
  if (!cloudFolder) return 'workspace'
  const { supportsCloudFolderWorkspace } = await import('@/lib/sync/cloud-folder')
  return supportsCloudFolderWorkspace(cloudFolder) ? 'workspace' : 'data'
}

/**
 * 依目前的同步方式建立遠端轉接。帳號層用資料同步庫（scope 'data'），筆記庫層用筆記庫遠端（scope 'workspace'）。
 * 條件寫入：Git 類用 sha、S3／WebDAV 用 etag、雲端資料夾只有 OneDrive 支援；不支援時用 withVerifiedWrites
 * 在 TS 端做寫前比對＋寫後重讀（ALMNC-85.5），避免兩台幾乎同時寫同一檔時後寫的永久蓋掉先寫的。
 */
export async function createRemoteLibraryAlmanacRemote(layer: AlmanacSyncLayer): Promise<AlmanacRemote> {
  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load('store.json')
  const platform = (await store.get<string>('primaryBackupMethod') || 'github') as Platform | 'local' | 'selfHosted'
  if (platform === 'local' || platform === 'selfHosted') {
    throw new Error(`almanac sync: ${platform} has no file remote`)
  }
  const cloudFolder = platform === 'cloudFolder'
    ? await store.get<CloudFolderConfig>('cloudFolderSyncConfig') ?? null
    : null
  const scope = await resolveAlmanacRemoteScope(layer, cloudFolder)
  const supportsCondition = platform !== 'cloudFolder' || cloudFolder?.provider === 'oneDrive'
  const remoteLibrary = await import('@/lib/sync/remote-library')

  const base: AlmanacRemote = {
    async read(path) {
      try {
        const metadata = await remoteLibrary.getRemoteFileMetadata(path, scope, platform)
        if (!metadata) return null
        const result = await remoteLibrary.downloadRemoteBytesWithVersion(path, scope, platform)
        return { content: new TextDecoder().decode(result.content), version: result.version ?? metadata.version ?? null }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    async write(path, content, guard) {
      try {
        const version = await remoteLibrary.uploadRemoteBytes(
          path,
          new TextEncoder().encode(content),
          `chore(almanac-sync): update ${path}`,
          'application/json',
          scope,
          supportsCondition ? guard : undefined,
          platform,
        )
        return { version: version || null }
      } catch (error) {
        if (supportsCondition && isAlmanacRemoteConflict(error)) throw new AlmanacRemoteConflictError(path)
        throw error
      }
    },
  }
  return supportsCondition ? base : withVerifiedWrites(base)
}
