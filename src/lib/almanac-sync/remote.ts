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
 * 條件寫入：Git 類用 sha、S3／WebDAV 用 etag、雲端資料夾只有 OneDrive 支援；不支援時退回一般寫入
 * （雲端資料夾本來就是單一使用者的同步資料夾，覆寫風險跟現有記錄同步相同）。
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

  return {
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
}
