// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandsMock = vi.hoisted(() => ({
  commitGitVersion: vi.fn(),
  setGitVersionAutoSnapshotContext: vi.fn(),
}))
vi.mock('./commands', () => ({
  commitGitVersion: commandsMock.commitGitVersion,
  setGitVersionAutoSnapshotContext: commandsMock.setGitVersionAutoSnapshotContext,
  AUTO_SNAPSHOT_COMMIT_SUMMARY: '自動快照',
}))

const workspaceSettingsMock = vi.hoisted(() => ({
  getGitVersionWorkspaceSettings: vi.fn(),
}))
vi.mock('./workspace-settings', () => ({
  getGitVersionWorkspaceSettings: workspaceSettingsMock.getGitVersionWorkspaceSettings,
  GIT_VERSION_SETTINGS_CHANGED_EVENT: 'notegen-git-version-settings-changed',
}))

const settingStoreMock = vi.hoisted(() => {
  let state = { workspacePath: '' }
  let listener: ((state: { workspacePath: string }) => void) | null = null
  return {
    getState: () => state,
    subscribe: (fn: (state: { workspacePath: string }) => void) => {
      listener = fn
      return () => { listener = null }
    },
    setWorkspacePath: (path: string) => {
      state = { workspacePath: path }
      listener?.(state)
    },
  }
})
vi.mock('@/stores/setting', () => ({ default: settingStoreMock }))

const workspaceMock = vi.hoisted(() => ({ getWorkspaceAbsolutePath: vi.fn() }))
vi.mock('@/lib/workspace', () => workspaceMock)

const emitterModule = await import('@/lib/emitter')
const emitter = emitterModule.default
const {
  AUTO_SNAPSHOT_IDLE_MS,
  configureAutoSnapshot,
  flushAutoSnapshot,
  initGitVersionAutoSnapshotRuntime,
  resetAutoSnapshotStateForTests,
} = await import('./auto-snapshot')

describe('git-versions/auto-snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    commandsMock.commitGitVersion.mockReset().mockResolvedValue({ id: 'abc123', kind: 'auto-snapshot' })
    commandsMock.setGitVersionAutoSnapshotContext.mockReset().mockResolvedValue(undefined)
    workspaceSettingsMock.getGitVersionWorkspaceSettings.mockReset()
    workspaceMock.getWorkspaceAbsolutePath.mockReset().mockResolvedValue('/vault')
    resetAutoSnapshotStateForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the active context to Rust and commits once the idle window elapses', async () => {
    await configureAutoSnapshot({ workspaceRoot: '/vault', enabled: true, autoSnapshotEnabled: true })
    expect(commandsMock.setGitVersionAutoSnapshotContext).toHaveBeenCalledWith({
      workspaceRoot: '/vault',
      autoSnapshotEnabled: true,
      snapshotSummary: '自動快照',
    })
    expect(commandsMock.commitGitVersion).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_IDLE_MS)
    expect(commandsMock.commitGitVersion).toHaveBeenCalledWith('/vault', '自動快照', 'auto-snapshot')
  })

  it('clears the idle timer and reports an inactive context when disabled', async () => {
    await configureAutoSnapshot({ workspaceRoot: '/vault', enabled: false, autoSnapshotEnabled: true })
    expect(commandsMock.setGitVersionAutoSnapshotContext).toHaveBeenCalledWith({
      workspaceRoot: null,
      autoSnapshotEnabled: false,
      snapshotSummary: '自動快照',
    })

    await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_IDLE_MS)
    expect(commandsMock.commitGitVersion).not.toHaveBeenCalled()
  })

  it('treats autoSnapshotEnabled=false the same as disabled even if version control is enabled', async () => {
    await configureAutoSnapshot({ workspaceRoot: '/vault', enabled: true, autoSnapshotEnabled: false })
    await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_IDLE_MS)
    expect(commandsMock.commitGitVersion).not.toHaveBeenCalled()
  })

  it('flushAutoSnapshot is a no-op when there is no active context', async () => {
    await flushAutoSnapshot()
    expect(commandsMock.commitGitVersion).not.toHaveBeenCalled()
  })

  it('resets the idle window on activity, so it only fires after the last save goes quiet', async () => {
    workspaceSettingsMock.getGitVersionWorkspaceSettings.mockResolvedValue({
      enabled: true,
      autoSnapshotEnabled: true,
    })
    const stop = initGitVersionAutoSnapshotRuntime()
    try {
      await vi.advanceTimersByTimeAsync(0)
      commandsMock.commitGitVersion.mockClear()

      await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_IDLE_MS - 1000)
      emitter.emit('article-saved', { path: 'a.md', content: '' })
      await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_IDLE_MS - 1000)
      expect(commandsMock.commitGitVersion).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000)
      expect(commandsMock.commitGitVersion).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })

  it('rehydrates from the stored settings when the workspace path changes', async () => {
    workspaceSettingsMock.getGitVersionWorkspaceSettings.mockResolvedValue({
      enabled: true,
      autoSnapshotEnabled: true,
    })
    workspaceMock.getWorkspaceAbsolutePath.mockResolvedValue('/vault-a')
    const stop = initGitVersionAutoSnapshotRuntime()
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(commandsMock.setGitVersionAutoSnapshotContext).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: '/vault-a' }),
      )

      workspaceMock.getWorkspaceAbsolutePath.mockResolvedValue('/vault-b')
      settingStoreMock.setWorkspacePath('/vault-b')
      await vi.advanceTimersByTimeAsync(0)
      expect(commandsMock.setGitVersionAutoSnapshotContext).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: '/vault-b' }),
      )
    } finally {
      stop()
    }
  })

  it('stops reacting to activity and workspace changes after the returned cleanup runs', async () => {
    workspaceSettingsMock.getGitVersionWorkspaceSettings.mockResolvedValue({
      enabled: true,
      autoSnapshotEnabled: true,
    })
    const stop = initGitVersionAutoSnapshotRuntime()
    await vi.advanceTimersByTimeAsync(0)
    stop()
    commandsMock.commitGitVersion.mockClear()

    emitter.emit('article-saved', { path: 'a.md', content: '' })
    await vi.advanceTimersByTimeAsync(AUTO_SNAPSHOT_IDLE_MS)
    expect(commandsMock.commitGitVersion).not.toHaveBeenCalled()
  })
})
