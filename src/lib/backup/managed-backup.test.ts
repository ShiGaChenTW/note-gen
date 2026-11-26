// @vitest-environment jsdom
// Fork（almanac ALMNC-84.3）：受管備份（自動備份）對未設定過的使用者預設每週開啟，且不覆寫已手動關閉或既有的自訂設定。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  storeData: new Map<string, unknown>(),
  invoke: vi.fn(async () => ({
    path: '/app-data/backups/test.ngbackup',
    name: 'test.ngbackup',
    createdAt: 1_700_000_000_000,
    size: 1024,
    appVersion: '0.1.0',
    reason: 'scheduled',
    workspaceIncluded: true,
    valid: true,
    error: null,
  })),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: state.invoke,
}))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/app-data'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async () => ({
      get: async <T>(key: string) => state.storeData.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        state.storeData.set(key, value)
      },
      save: async () => {},
    }),
  },
}))

const {
  DEFAULT_MANAGED_BACKUP_SCHEDULE,
  loadManagedBackupSettings,
  runScheduledBackupIfDue,
  saveManagedBackupSettings,
} = await import('./managed-backup')

describe('managed-backup defaults (ALMNC-84.3)', () => {
  beforeEach(() => {
    state.storeData.clear()
    state.invoke.mockClear()
  })

  it('AC#1: 新安裝與從未設定過的使用者預設每週自動備份到 appDataDir/backups', async () => {
    expect(DEFAULT_MANAGED_BACKUP_SCHEDULE).toBe('weekly')
    const loaded = await loadManagedBackupSettings()
    expect(loaded).toEqual({
      directory: '/app-data/backups',
      schedule: 'weekly',
      retention: 10,
      lastSuccessAt: null,
      lastError: null,
    })

    await runScheduledBackupIfDue()
    expect(state.invoke).toHaveBeenCalledWith('create_managed_backup', {
      backupDir: '/app-data/backups',
      workspacePath: '',
      retention: 10,
      reason: 'scheduled',
    })
  })

  it('AC#2: 已手動關閉的使用者維持 disabled，不觸發自動備份', async () => {
    state.storeData.set('managedBackupDirectory', '/Users/scott/Backups')
    state.storeData.set('managedBackupSchedule', 'disabled')

    const loaded = await loadManagedBackupSettings()
    expect(loaded.schedule).toBe('disabled')
    expect(loaded.directory).toBe('/Users/scott/Backups')

    await runScheduledBackupIfDue()
    expect(state.invoke).not.toHaveBeenCalled()
  })

  it('AC#2: 明確清除備份目錄並關閉時保留空字串與 disabled，不被預設值蓋回', async () => {
    await saveManagedBackupSettings({
      directory: '',
      schedule: 'disabled',
      retention: 10,
    })

    const loaded = await loadManagedBackupSettings()
    expect(loaded.directory).toBe('')
    expect(loaded.schedule).toBe('disabled')
  })

  it('AC#3: 既有自訂排程、目錄與保留份數不被預設值覆寫', async () => {
    state.storeData.set('managedBackupDirectory', '/Users/scott/CustomBackups')
    state.storeData.set('managedBackupSchedule', 'daily')
    state.storeData.set('managedBackupRetention', 20)
    state.storeData.set('managedBackupLastSuccessAt', 12345)

    const loaded = await loadManagedBackupSettings()
    expect(loaded).toEqual({
      directory: '/Users/scott/CustomBackups',
      schedule: 'daily',
      retention: 20,
      lastSuccessAt: 12345,
      lastError: null,
    })
  })
})
