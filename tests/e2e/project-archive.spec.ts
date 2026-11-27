// Fork（almanac ALMNC-89）：對話頁結束專案 → 專案筆記封存、知識筆記不動 → 搜尋得到 → 取消封存還原。
import { expect, test, type Page } from '@playwright/test'
import { setupTauriMock, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

const PROJECT_PATH = '40 專案/電子紙.md'
const KNOWLEDGE_PATH = '知識/墨水屏刷新.md'
// 筆記都帶合法 id：沒有 id 的 V3 筆記會在索引就緒 1.5 秒後被補號掃描（id-scan-service）改寫，
// 斷言整份內容是否原封不動時就會看時序。
const PROJECT_NOTE = '---\nid: N-20261101-090000-EP01\ntype: project\ntitle: 電子紙\n---\n# 電子紙\n\n目標：做出電子紙簡報。\n'
const KNOWLEDGE_NOTE = '---\nid: N-20261101-090000-KN01\ntype: knowledge\ntitle: 墨水屏刷新\ndomains: [D-hardware]\nproject: 電子紙\n---\n局部刷新會殘影。參考 [[電子紙]]。\n'

async function waitForMainBoot(page: Page) {
  await expect(page.getByRole('navigation', { name: '主要導覽' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新增', exact: true }).first()).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => {
    pageErrors.push(error)
  })
  mock = await setupTauriMock(page)
})

test.afterEach(() => {
  mock?.dispose()
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0)
})

test('結束專案：專案筆記封存、知識筆記不動、從進行中清單移走但搜尋得到，取消封存後還原', async ({ page }) => {
  mock.writeVaultFile(PROJECT_PATH, PROJECT_NOTE)
  mock.writeVaultFile(KNOWLEDGE_PATH, KNOWLEDGE_NOTE)
  mock.setStoreKey('threadProjects', { 'e2e-s1': '電子紙', 'e2e-s2': '搬家' })

  await page.goto('/core/main')
  await waitForMainBoot(page)
  // conversations 的欄位是啟動時一個一個 alter 上去的：等最後一個欄位出現才插資料，免得插到一半的 schema。
  await expect.poll(() =>
    mock.querySql<{ name: string }>(
      "SELECT name FROM pragma_table_info('conversations') WHERE name IN ('syncId', 'syncUpdatedAt', 'deletedAt')",
    ).length,
  ).toBe(3)
  const now = Date.now()
  // 搬家清單較新：重新載入後對話面板會自動切到最新的一段，讓「目前對話」固定落在別的專案。
  // 目前對話本來就會留在清單上（groupThreads keepId），不固定的話，結束專案後電子紙那段是否還在要看啟動時序。
  mock.execSql(
    'INSERT INTO conversations (syncId, syncUpdatedAt, title, createdAt, updatedAt, messageCount, isPinned) VALUES (?, ?, ?, ?, ?, ?, 0)',
    ['e2e-s1', now - 1000, '電子紙排版討論', now - 1000, now - 1000, 2],
  )
  mock.execSql(
    'INSERT INTO conversations (syncId, syncUpdatedAt, title, createdAt, updatedAt, messageCount, isPinned) VALUES (?, ?, ?, ?, ?, ?, 0)',
    ['e2e-s2', now, '搬家清單', now, now, 2],
  )
  await page.reload()
  await waitForMainBoot(page)

  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '對話', exact: true }).click()
  const list = page.getByRole('list', { name: '對話串' })
  await expect(list.getByRole('button', { name: /電子紙排版討論/ })).toBeVisible()

  // 結束專案（要先確認）
  await list.getByRole('button', { name: '「電子紙」的專案動作' }).click()
  await page.getByRole('menuitem', { name: '結束專案…' }).click()
  const dialog = page.getByRole('dialog', { name: '結束專案「電子紙」？' })
  await expect(dialog).toContainText('知識筆記留在原本的領域')
  await dialog.getByRole('button', { name: '結束並封存' }).click()
  await expect(page.getByText('已結束專案「電子紙」，封存 1 則專案筆記')).toBeVisible()

  // 進行中清單移走；專案筆記封存（還在）；知識筆記原封不動
  await expect(list.getByRole('button', { name: /電子紙排版討論/ })).toBeHidden()
  await expect(list.getByRole('button', { name: /搬家清單/ })).toBeVisible()
  await expect.poll(() => mock.readVaultFile(PROJECT_PATH)).toContain('status: archived')
  expect(mock.readVaultFile(PROJECT_PATH)).toContain('目標：做出電子紙簡報。')
  expect(mock.readVaultFile(KNOWLEDGE_PATH)).toBe(KNOWLEDGE_NOTE)
  expect(mock.getStoreKey<Record<string, unknown>>('archivedProjects')).toHaveProperty('電子紙')

  // 搜尋得到
  const search = page.getByRole('textbox', { name: '搜尋對話或專案' })
  await search.fill('電子紙')
  await expect(list.getByRole('button', { name: /電子紙排版討論/ })).toBeVisible()
  await expect(list.getByText('已封存', { exact: true })).toBeVisible()
  await search.fill('')

  // 取消封存
  await list.getByRole('button', { name: /已封存的專案/ }).click()
  await list.getByRole('button', { name: '取消封存「電子紙」' }).click()
  await expect(list.getByRole('button', { name: /電子紙排版討論/ })).toBeVisible()
  await expect.poll(() => mock.readVaultFile(PROJECT_PATH)).toBe(PROJECT_NOTE)
  expect(mock.readVaultFile(KNOWLEDGE_PATH)).toBe(KNOWLEDGE_NOTE)
  expect(mock.getStoreKey('archivedProjects')).toEqual({})
})

test('只有專案筆記、沒有對話分組的專案：從編輯器工具列結束與取消封存', async ({ page }) => {
  const path = '讀書會.md'
  const note = '---\nid: N-20261101-090000-BC01\ntype: project\ntitle: 讀書會\n---\n# 讀書會\n\n每月一本。\n'
  mock.writeVaultFile(path, note)
  mock.writeVaultFile(KNOWLEDGE_PATH, KNOWLEDGE_NOTE)

  await page.goto('/core/main')
  await waitForMainBoot(page)
  const tree = page.getByRole('tree', { name: '工作區檔案' })
  const expand = page.getByRole('button', { name: '展開我的筆記', exact: true })
  await expect(tree.or(expand)).toBeVisible()
  if (await expand.isVisible()) await expand.click()
  await tree.getByRole('treeitem', { name: /讀書會/ }).click()

  const toolbar = page.getByRole('toolbar', { name: '筆記工具列' })
  await toolbar.getByRole('button', { name: '結束專案…' }).click()
  const dialog = page.getByRole('dialog', { name: '結束專案「讀書會」？' })
  await dialog.getByRole('button', { name: '結束並封存' }).click()
  await expect(page.getByText('已結束專案「讀書會」，封存 1 則專案筆記')).toBeVisible()
  await expect.poll(() => mock.readVaultFile(path)).toContain('status: archived')
  expect(mock.readVaultFile(path)).toContain('每月一本。')
  expect(mock.readVaultFile(KNOWLEDGE_PATH)).toBe(KNOWLEDGE_NOTE)
  expect(mock.getStoreKey<Record<string, unknown>>('archivedProjects')).toHaveProperty('讀書會')

  await toolbar.getByRole('button', { name: '取消封存' }).click()
  await expect(page.getByText('專案「讀書會」回到進行中')).toBeVisible()
  await expect.poll(() => mock.readVaultFile(path)).toBe(note)
  expect(mock.getStoreKey('archivedProjects')).toEqual({})
  await expect(toolbar.getByRole('button', { name: '結束專案…' })).toBeVisible()
})
