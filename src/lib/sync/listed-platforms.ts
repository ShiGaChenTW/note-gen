import { GitlabInstanceType } from '@/lib/sync/gitlab.types'
import type { SyncPlatform } from '@/types/sync'

/**
 * Fork（almanac ALMNC-83.6）：同步設定頁不再列出 Gitee、极狐（GitLab 中國）、OneDrive。
 * 只藏選項，不刪設定與程式：目前正在用的那一個照樣列出，使用者才不會被困住、也能切走。
 */
export const UNLISTED_SYNC_PLATFORMS: readonly SyncPlatform[] = ['gitee']

export function isSyncPlatformListed(platform: SyncPlatform, primaryBackupMethod: SyncPlatform) {
  return !UNLISTED_SYNC_PLATFORMS.includes(platform) || platform === primaryBackupMethod
}

/** 手機的 OneDrive 分頁：只有目前主要同步方式就是 OneDrive 雲端資料夾時才列出。 */
export function isOneDriveListed(
  primaryBackupMethod: SyncPlatform,
  activeCloudFolderProvider: 'folder' | 'oneDrive' | null,
) {
  return primaryBackupMethod === 'cloudFolder' && activeCloudFolderProvider === 'oneDrive'
}

/** GitLab 實例選項：极狐只在已經選它時列出。 */
export function listedGitlabInstanceTypes(current: GitlabInstanceType): GitlabInstanceType[] {
  return [
    GitlabInstanceType.OFFICIAL,
    ...(current === GitlabInstanceType.JIHULAB ? [GitlabInstanceType.JIHULAB] : []),
    GitlabInstanceType.SELF_HOSTED,
  ]
}
