import { describe, expect, it } from 'vitest'
import { GitlabInstanceType } from '@/lib/sync/gitlab.types'
import { SYNC_PLATFORMS } from '@/types/sync'
import { isOneDriveListed, isSyncPlatformListed, listedGitlabInstanceTypes } from './listed-platforms'

describe('listed sync platforms', () => {
  it('hides Gitee unless it is the current primary method', () => {
    const listed = SYNC_PLATFORMS.filter(platform => isSyncPlatformListed(platform, 'github'))
    expect(listed).not.toContain('gitee')
    expect(listed).toContain('gitlab')
    expect(isSyncPlatformListed('gitee', 'gitee')).toBe(true)
  })

  it('lists OneDrive only when it is the active cloud folder provider', () => {
    expect(isOneDriveListed('github', null)).toBe(false)
    expect(isOneDriveListed('cloudFolder', 'folder')).toBe(false)
    expect(isOneDriveListed('cloudFolder', 'oneDrive')).toBe(true)
  })

  it('hides the JiHu GitLab instance unless it is already selected', () => {
    expect(listedGitlabInstanceTypes(GitlabInstanceType.OFFICIAL)).toEqual([
      GitlabInstanceType.OFFICIAL,
      GitlabInstanceType.SELF_HOSTED,
    ])
    expect(listedGitlabInstanceTypes(GitlabInstanceType.JIHULAB)).toContain(GitlabInstanceType.JIHULAB)
  })
})
