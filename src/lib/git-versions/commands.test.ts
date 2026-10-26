import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const {
  AUTO_SNAPSHOT_COMMIT_SUMMARY,
  commitGitVersion,
  detectGitVersionRepo,
  diffGitVersionFile,
  enableGitVersionControl,
  getGitVersionStatus,
  listGitVersionLog,
  setGitVersionAutoSnapshotContext,
  showGitVersionFile,
} = await import('./commands')

describe('git-versions/commands', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('detectGitVersionRepo calls git_version_detect with the workspace root', async () => {
    invokeMock.mockResolvedValue({ hasExistingRepo: true })
    const result = await detectGitVersionRepo('/vault')
    expect(invokeMock).toHaveBeenCalledWith('git_version_detect', { workspaceRoot: '/vault' })
    expect(result).toEqual({ hasExistingRepo: true })
  })

  it('enableGitVersionControl calls git_version_enable with the workspace root', async () => {
    invokeMock.mockResolvedValue({ reusedExisting: false, createdGitignore: true })
    const result = await enableGitVersionControl('/vault')
    expect(invokeMock).toHaveBeenCalledWith('git_version_enable', { workspaceRoot: '/vault' })
    expect(result.createdGitignore).toBe(true)
  })

  it('getGitVersionStatus calls git_version_status', async () => {
    invokeMock.mockResolvedValue({ isRepo: true, hasCommits: false })
    await getGitVersionStatus('/vault')
    expect(invokeMock).toHaveBeenCalledWith('git_version_status', { workspaceRoot: '/vault' })
  })

  it('commitGitVersion defaults paths to null and forwards kind/summary', async () => {
    invokeMock.mockResolvedValue({ id: 'abc', kind: 'auto-snapshot' })
    await commitGitVersion('/vault', '自動快照', 'auto-snapshot')
    expect(invokeMock).toHaveBeenCalledWith('git_version_commit', {
      workspaceRoot: '/vault',
      summary: '自動快照',
      kind: 'auto-snapshot',
      paths: null,
    })
  })

  it('commitGitVersion forwards explicit paths for prompt versions', async () => {
    invokeMock.mockResolvedValue(null)
    const result = await commitGitVersion('/vault', '第一版', 'prompt-version', ['Prompts/a.md'])
    expect(invokeMock).toHaveBeenCalledWith('git_version_commit', {
      workspaceRoot: '/vault',
      summary: '第一版',
      kind: 'prompt-version',
      paths: ['Prompts/a.md'],
    })
    expect(result).toBeNull()
  })

  it('listGitVersionLog defaults path/limit to null when omitted', async () => {
    invokeMock.mockResolvedValue([])
    await listGitVersionLog('/vault')
    expect(invokeMock).toHaveBeenCalledWith('git_version_log', {
      workspaceRoot: '/vault',
      path: null,
      limit: null,
    })
  })

  it('listGitVersionLog forwards the provided path/limit', async () => {
    invokeMock.mockResolvedValue([])
    await listGitVersionLog('/vault', { path: 'Prompts/a.md', limit: 10 })
    expect(invokeMock).toHaveBeenCalledWith('git_version_log', {
      workspaceRoot: '/vault',
      path: 'Prompts/a.md',
      limit: 10,
    })
  })

  it('showGitVersionFile calls git_version_show', async () => {
    invokeMock.mockResolvedValue('content')
    const result = await showGitVersionFile('/vault', 'deadbeef', 'a.md')
    expect(invokeMock).toHaveBeenCalledWith('git_version_show', {
      workspaceRoot: '/vault',
      commitId: 'deadbeef',
      path: 'a.md',
    })
    expect(result).toBe('content')
  })

  it('diffGitVersionFile calls git_version_diff', async () => {
    invokeMock.mockResolvedValue({ oldContent: 'old', newContent: 'new' })
    await diffGitVersionFile('/vault', 'deadbeef', 'a.md')
    expect(invokeMock).toHaveBeenCalledWith('git_version_diff', {
      workspaceRoot: '/vault',
      commitId: 'deadbeef',
      path: 'a.md',
    })
  })

  it('setGitVersionAutoSnapshotContext forwards the full context', async () => {
    invokeMock.mockResolvedValue(undefined)
    await setGitVersionAutoSnapshotContext({
      workspaceRoot: '/vault',
      autoSnapshotEnabled: true,
      snapshotSummary: AUTO_SNAPSHOT_COMMIT_SUMMARY,
    })
    expect(invokeMock).toHaveBeenCalledWith('git_version_set_auto_snapshot_context', {
      workspaceRoot: '/vault',
      autoSnapshotEnabled: true,
      snapshotSummary: AUTO_SNAPSHOT_COMMIT_SUMMARY,
    })
  })
})
