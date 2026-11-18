import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  set: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: vi.fn(async () => store) } }))

const { default: useSettingStore } = await import('./setting')

beforeEach(() => {
  vi.clearAllMocks()
  useSettingStore.setState({ agentPermissionMode: 'ask', lastAgentEditPermission: 'ask' })
})

describe('chat edit permissions', () => {
  it('persists the last delegated permission separately when switching to read-only', async () => {
    const { setAgentPermissionMode } = useSettingStore.getState()
    await setAgentPermissionMode('auto-edit')
    await setAgentPermissionMode('read-only')

    expect(useSettingStore.getState()).toMatchObject({
      agentPermissionMode: 'read-only',
      lastAgentEditPermission: 'auto-edit',
    })
    expect(store.set.mock.calls.slice(-2)).toEqual([
      ['lastAgentEditPermission', 'auto-edit'],
      ['agentPermissionMode', 'read-only'],
    ])
    expect(store.save).toHaveBeenCalledTimes(2)
  })

  it('leaves the newest mode persisted after rapid switching', async () => {
    const { setAgentPermissionMode } = useSettingStore.getState()
    await Promise.all([
      setAgentPermissionMode('auto-edit'),
      setAgentPermissionMode('read-only'),
      setAgentPermissionMode('ask'),
    ])
    expect(store.set.mock.calls.slice(-2)).toEqual([
      ['lastAgentEditPermission', 'ask'],
      ['agentPermissionMode', 'ask'],
    ])
  })
})
