// Fork（almanac ALMNC-56.7，RPT-2026-009 A06）：讀資料源表失敗時記下 sourcesError（桌面 App 才算，瀏覽器預覽沒有資料庫是正常的）；讀成功就清掉。
import { beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  fail: false,
  tauri: true,
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => fake.tauri }))
vi.mock('@/db/v3-sources', () => ({
  listSources: async () => { if (fake.fail) throw new Error('database is locked'); return [] },
  countOutputsBySource: async () => new Map(),
  listLegacyNoteSources: async () => { throw new Error('skip legacy') },
}))
vi.mock('@/db/v3-legacy-packs', () => ({ listOpenLegacyPacks: async () => [] }))
vi.mock('@/lib/migration/runtime', () => ({ legacyRunning: () => ({ running: false, pausing: false }) }))
vi.mock('@/db/v3-source-judgements', () => ({ listSourceJudgements: async () => new Map() }))

const useWorkbenchStore = (await import('@/stores/workbench')).default
const { refreshSources } = await import('./actions')

beforeEach(() => {
  fake.fail = false
  fake.tauri = true
  useWorkbenchStore.setState({ sourcesError: false, sourcesLoaded: false })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})

it('marks a load failure in the desktop app and clears it after a successful retry', async () => {
  fake.fail = true
  await refreshSources()
  expect(useWorkbenchStore.getState().sourcesError).toBe(true)
  expect(useWorkbenchStore.getState().sourcesLoaded).toBe(false)
  fake.fail = false
  await refreshSources()
  expect(useWorkbenchStore.getState().sourcesError).toBe(false)
  expect(useWorkbenchStore.getState().sourcesLoaded).toBe(true)
})

it('does not show an error in the browser preview (no Tauri, no database)', async () => {
  fake.fail = true
  fake.tauri = false
  await refreshSources()
  expect(useWorkbenchStore.getState().sourcesError).toBe(false)
})
