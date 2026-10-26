// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeMock = vi.hoisted(() => {
  const data = new Map<string, unknown>()
  return {
    data,
    load: vi.fn(async () => ({
      get: vi.fn(async (key: string) => data.get(key)),
      set: vi.fn(async (key: string, value: unknown) => { data.set(key, value) }),
      save: vi.fn(async () => {}),
    })),
  }
})
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: storeMock.load } }))

const {
  GIT_VERSION_SETTINGS_CHANGED_EVENT,
  getGitVersionWorkspaceSettings,
  setGitVersionWorkspaceSettings,
} = await import('./workspace-settings')

describe('git-versions/workspace-settings', () => {
  beforeEach(() => {
    storeMock.data.clear()
  })

  it('defaults to disabled with auto snapshot on for an unseen workspace', async () => {
    const settings = await getGitVersionWorkspaceSettings('/vault')
    expect(settings).toEqual({ enabled: false, autoSnapshotEnabled: true })
  })

  it('round-trips a saved setting for the same workspace', async () => {
    await setGitVersionWorkspaceSettings('/vault', { enabled: true })
    const settings = await getGitVersionWorkspaceSettings('/vault')
    expect(settings).toEqual({ enabled: true, autoSnapshotEnabled: true })
  })

  it('merges partial updates instead of overwriting the whole record', async () => {
    await setGitVersionWorkspaceSettings('/vault', { enabled: true })
    await setGitVersionWorkspaceSettings('/vault', { autoSnapshotEnabled: false })
    const settings = await getGitVersionWorkspaceSettings('/vault')
    expect(settings).toEqual({ enabled: true, autoSnapshotEnabled: false })
  })

  it('keeps settings isolated per workspace path', async () => {
    await setGitVersionWorkspaceSettings('/vault-a', { enabled: true })
    const settingsA = await getGitVersionWorkspaceSettings('/vault-a')
    const settingsB = await getGitVersionWorkspaceSettings('/vault-b')
    expect(settingsA.enabled).toBe(true)
    expect(settingsB.enabled).toBe(false)
  })

  it('normalizes a trailing slash so it does not create a second record', async () => {
    await setGitVersionWorkspaceSettings('/vault/', { enabled: true })
    const settings = await getGitVersionWorkspaceSettings('/vault')
    expect(settings.enabled).toBe(true)
  })

  it('dispatches the settings-changed event so the auto-snapshot runtime can react', async () => {
    const handler = vi.fn()
    window.addEventListener(GIT_VERSION_SETTINGS_CHANGED_EVENT, handler)
    try {
      await setGitVersionWorkspaceSettings('/vault', { enabled: true })
      expect(handler).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(GIT_VERSION_SETTINGS_CHANGED_EVENT, handler)
    }
  })
})
