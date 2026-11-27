// Fork（almanac ALMNC-89）：對話頁結束專案 → 專案筆記封存、知識筆記不動 → 搜尋得到 → 取消封存還原。
import { expect, test, type Page } from '@playwright/test'
import { setupTauriMock, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

const PROJECT_PATH = '40 專案/電子紙.md'
const KNOWLEDGE_PATH = '知識/墨水屏刷新.md'
const PROJECT_NOTE = '---\ntype: project\ntitle: 電子紙\n---\n# 電子紙\n\n目標：做出電子紙簡報。\n'
const KNOWLEDGE_NOTE = '---\ntype: knowledge\ntitle: 墨水屏刷新\ndomains: [D-hardware]\nproject: 電子紙\n---\n局部刷新會殘影。參考 [[電子紙]]。\n'

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
  await expect.poll(() =>
    mock.querySql<{ name: string }>("SELECT name FROM pragma_table_info('conversations') WHERE name = 'syncId'").length,
  ).toBe(1)
  const now = Date.now()
  mock.execSql(
    'INSERT INTO conversations (syncId, syncUpdatedAt, title, createdAt, updatedAt, messageCount, isPinned) VALUES (?, ?, ?, ?, ?, ?, 0)',
    ['e2e-s1', now, '電子紙排版討論', now, now, 2],
  )
  mock.execSql(
    'INSERT INTO conversations (syncId, syncUpdatedAt, title, createdAt, updatedAt, messageCount, isPinned) VALUES (?, ?, ?, ?, ?, ?, 0)',
    ['e2e-s2', now - 1000, '搬家清單', now - 1000, now - 1000, 2],
  )

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
