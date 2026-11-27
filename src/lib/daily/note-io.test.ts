// Fork（almanac ALMNC-85.4 驗收 #2）：App 自己寫的筆記（每日筆記、MOC）跟編輯器存檔一樣排進檔案推送佇列（設計 1.9）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  selfHosted: false,
  addTask: vi.fn(),
  appWrites: [] as Array<[string, string | null | undefined, string]>,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (path: string) => fake.files.has(path) || [...fake.files.keys()].some(key => key.startsWith(`${path}/`))),
  mkdir: vi.fn(async () => undefined),
  readTextFile: vi.fn(async (path: string) => fake.files.get(path) ?? ''),
  writeTextFile: vi.fn(async (path: string, content: string) => { fake.files.set(path, content) }),
}))
vi.mock('@/lib/workspace', () => ({
  getFilePathOptions: vi.fn(async (path: string) => ({ path })),
  getWorkspacePath: vi.fn(async () => ({ path: '/vault', isCustom: true })),
}))
vi.mock('@/lib/self-hosted-sync/files', () => ({
  writeSelfHostedWorkspaceText: vi.fn(async (path: string, content: string) => {
    if (!fake.selfHosted) return false
    fake.files.set(path, content)
    return true
  }),
  deleteSelfHostedWorkspacePath: vi.fn(async () => false),
}))
vi.mock('@/lib/trash/runtime', () => ({ moveToAppTrash: vi.fn() }))
vi.mock('@/stores/article', () => ({ default: { getState: () => ({}) } }))
vi.mock('@/lib/moc/app-writes', () => ({
  noteAppWrite: (path: string, before: string | null | undefined, after: string) => fake.appWrites.push([path, before, after]),
}))
vi.mock('@/lib/sync/sync-push-queue', () => ({ getSyncPushQueue: () => ({ addTask: fake.addTask }) }))

const { writeNote } = await import('./note-io')

async function flushDynamicImports() {
  await vi.waitFor(() => expect(fake.addTask).toHaveBeenCalled())
}

beforeEach(() => {
  fake.files.clear()
  fake.selfHosted = false
  fake.addTask.mockClear()
  fake.appWrites.length = 0
})

describe('writeNote：App 寫完筆記就排進檔案推送佇列（85.4 #2）', () => {
  const cases = [
    { name: '每日筆記（覆寫）', path: 'Journal/2026-11-27.md', content: '# 今天\n- [ ] 回覆 Mia\n', options: undefined },
    { name: 'MOC（App 寫的收錄）', path: '20 領域/時間管理.md', content: '---\nkind: domain\n---\n# 時間管理\n', options: undefined },
    { name: '新建的筆記（createNew）', path: '10 知識/新筆記.md', content: '# 新筆記\n', options: { createNew: true } },
  ]

  it.each(cases)('$name：寫進檔案、記 App 寫入、排推送', async ({ path, content, options }) => {
    await writeNote(path, content, options)
    expect(fake.files.get(path)).toBe(content)
    expect(fake.appWrites.map(([written]) => written)).toEqual([path])
    await flushDynamicImports()
    expect(fake.addTask).toHaveBeenCalledWith(path)
  })

  it('自架同步的原子寫入也排推送（佇列再交給自架的 outbox）', async () => {
    fake.selfHosted = true
    await writeNote('Journal/2026-11-27.md', '自架')
    await flushDynamicImports()
    expect(fake.addTask).toHaveBeenCalledWith('Journal/2026-11-27.md')
  })
})
