import { expect, test, type Locator, type Page } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

async function waitForDbReady() {
  await expect.poll(() =>
    mock.querySql<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sources','source_judgements','conversations','chats','marks','tags','trash_items')"
    ).length
  ).toBe(7)
}

async function ensureNotesTreeExpanded(page: Page): Promise<Locator> {
  const tree = page.getByRole('tree', { name: '工作區檔案' })
  const expandBtn = page.getByRole('button', { name: '展開我的筆記', exact: true })
  await expect(tree.or(expandBtn)).toBeVisible()
  if (await expandBtn.isVisible()) {
    await expandBtn.click()
  }
  await expect(tree).toBeVisible()
  return tree
}

async function openRecentlyDeleted(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '最近刪除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '設定', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeSettingsDialog(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
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

test('AC #1a：筆記刪除 → 最近刪除（筆記與資料夾）→ 還原恢復檔案樹與硬碟', async ({ page }) => {
  mock.writeVaultFile('待刪筆記.md', '# 待刪筆記\n\n這是一段會進最近刪除後再還原的內容。')
  await page.goto('/core/main')
  await waitForMainBoot(page)

  const tree = await ensureNotesTreeExpanded(page)
  const noteItem = tree.getByRole('treeitem', { name: /待刪筆記/ })
  await expect(noteItem).toBeVisible()

  await noteItem.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /刪除/ }).click()

  await expect(noteItem).toBeHidden()
  await expect.poll(() => mock.fileExists('待刪筆記.md')).toBe(false)
  await expect.poll(() => mock.listVaultFiles({ includeHidden: true }).some(p => p.startsWith('.almanac-trash/'))).toBe(true)

  const settings = await openRecentlyDeleted(page)
  const categories = settings.getByRole('tablist', { name: '最近刪除分類' })
  await categories.getByRole('tab', { name: '筆記與資料夾', exact: true }).click()

  const trashEntry = settings.getByRole('listitem', { name: '待刪筆記.md' })
  await expect(trashEntry).toBeVisible()
  await expect(trashEntry).toContainText('檔案')
  await expect(trashEntry).toContainText('剩餘 30 天')

  await trashEntry.getByRole('button', { name: '還原', exact: true }).click()
  await expect(page.getByText('已還原「待刪筆記.md」')).toBeVisible()
  await expect(trashEntry).toBeHidden()
  await expect(settings.getByText('最近刪除是空的')).toBeVisible()

  await closeSettingsDialog(settings)
  await expect(tree.getByRole('treeitem', { name: /待刪筆記/ })).toBeVisible()
  await expect.poll(() => mock.fileExists('待刪筆記.md')).toBe(true)
  expect(mock.readVaultFile('待刪筆記.md')).toContain('這是一段會進最近刪除後再還原的內容。')
})

test('AC #1b：擷取失敗資料源刪除 → 最近刪除（記錄）→ 還原回到資料源清單與 SQLite', async ({ page }) => {
  await page.goto('/core/main')
  await waitForMainBoot(page)
  await waitForDbReady()

  const now = Date.now()
  mock.execSql(
    `INSERT INTO sources
       (id, source_type, kind, content, origin, collected_at, collector, status, status_changed_at, version, previous_id, locked_at, archived_at, created_at, updated_at, is_journal, legacy_id)
     VALUES (?, 'external', 'link', ?, 'https://example.com/failed-article', ?, 'web', 'awaiting_decision', ?, 1, NULL, NULL, NULL, ?, ?, 0, NULL)`,
    ['S-e2e-fail-1', 'E2E 擷取失敗資料源', now, now, now, now]
  )
  mock.execSql(
    `INSERT INTO source_judgements
       (source_id, status, type, suggestion, model, error, follow_suggestion, created_at, updated_at)
     VALUES (?, 'capture_failed', NULL, NULL, 'e2e-mock', '403 Forbidden', 0, ?, ?)`,
    ['S-e2e-fail-1', now, now]
  )

  await page.getByRole('button', { name: '工作台', exact: true }).click()
  const workbench = page.getByRole('region', { name: '工作台' })
  await expect(workbench).toBeVisible()
  await workbench.getByRole('tab', { name: /^資料源/ }).click()

  const sourceRowBtn = workbench.getByRole('button', { name: /E2E 擷取失敗資料源/ })
  await expect(sourceRowBtn).toBeVisible()
  await sourceRowBtn.click()
  await workbench.getByRole('button', { name: '刪除', exact: true }).click()

  await expect(sourceRowBtn).toBeHidden()
  await expect.poll(() => mock.querySql('SELECT id FROM sources WHERE id = ?', ['S-e2e-fail-1'])).toHaveLength(0)

  const settings = await openRecentlyDeleted(page)
  const categories = settings.getByRole('tablist', { name: '最近刪除分類' })
  await categories.getByRole('tab', { name: '記錄', exact: true }).click()

  const trashEntry = settings.getByRole('listitem', { name: 'E2E 擷取失敗資料源' })
  await expect(trashEntry).toBeVisible()
  await expect(trashEntry).toContainText('資料源')
  await expect(trashEntry).toContainText('來源：刪除資料源')

  await trashEntry.getByRole('button', { name: '還原', exact: true }).click()
  await expect(page.getByText('已還原「E2E 擷取失敗資料源」')).toBeVisible()
  await expect(trashEntry).toBeHidden()
  await expect.poll(() => mock.querySql<{ id: string }>('SELECT id FROM sources WHERE id = ?', ['S-e2e-fail-1'])).toHaveLength(1)

  await closeSettingsDialog(settings)
  await expect(workbench.getByRole('button', { name: /E2E 擷取失敗資料源/ })).toBeVisible()
})

test('AC #1c：標籤經由轉化文章刪除 → 最近刪除（記錄）→ 還原標籤與關聯記錄', async ({ page }) => {
  await page.goto('/core/main')
  await waitForMainBoot(page)
  await waitForDbReady()

  const now = Date.now()
  // initTagsDb only seeds the locked default tag into an empty table; seed it
  // explicitly so the deletable tag below is not the last one.
  mock.execSql(
    'INSERT OR IGNORE INTO tags (id, name, isLocked, isPin, sortOrder) VALUES (?, ?, 1, 1, 0)',
    [1, 'Idea']
  )
  mock.execSql(
    'INSERT INTO tags (id, name, isLocked, isPin, sortOrder) VALUES (?, ?, 0, 0, 1)',
    [2, 'E2E標籤分類']
  )
  mock.execSql(
    `INSERT INTO marks (id, tagId, type, content, url, desc, deleted, createdAt)
     VALUES (?, ?, 'text', ?, '', ?, 0, ?)`,
    [10, 2, '標籤下需要一併保護的記錄', '記錄摘要', now]
  )
  mock.execSql(
    `INSERT INTO conversations (id, title, createdAt, updatedAt, messageCount, isPinned, syncId, syncUpdatedAt, deletedAt)
     VALUES (?, ?, ?, ?, 1, 0, ?, ?, NULL)`,
    [10, 'E2E 標籤轉化對話', now, now, 'e2e-conv-tag-10', now]
  )
  mock.execSql(
    `INSERT INTO chats (id, tagId, content, role, type, inserted, createdAt, conversationId, syncId, syncUpdatedAt)
     VALUES (?, ?, ?, 'system', 'note', 0, ?, ?, ?, ?)`,
    [10, 2, '# E2E標籤轉化筆記\n\n測試刪除目前標籤與還原流程。', now, 10, 'e2e-chat-tag-10', now]
  )
  mock.setStoreKey('currentTagId', 2)

  await page.reload()
  await waitForMainBoot(page)

  const convertBtn = page.getByRole('button', { name: '轉化文章', exact: true })
  await expect(convertBtn).toBeVisible()
  await convertBtn.click()

  const convertDialog = page.getByRole('dialog', { name: '轉化文章' })
  await expect(convertDialog).toBeVisible()
  const deleteTagCheckbox = convertDialog.getByRole('checkbox', { name: '刪除目前標籤、記錄和筆記（回收站可恢復）' })
  await expect(deleteTagCheckbox).toBeEnabled()
  await expect(deleteTagCheckbox).toBeChecked()

  await convertDialog.getByRole('button', { name: '轉化', exact: true }).click()

  await expect.poll(() => mock.fileExists('E2E標籤轉化筆記.md')).toBe(true)
  await expect.poll(() => mock.querySql('SELECT id FROM tags WHERE name = ?', ['E2E標籤分類'])).toHaveLength(0)
  await expect.poll(() => mock.querySql<{ entity_id: string }>("SELECT entity_id FROM trash_items WHERE entity_type = 'tag' AND title = ?", ['E2E標籤分類'])).toHaveLength(1)
  await waitForMainBoot(page)

  const settings = await openRecentlyDeleted(page)
  const categories = settings.getByRole('tablist', { name: '最近刪除分類' })
  await categories.getByRole('tab', { name: '記錄', exact: true }).click()

  const trashEntry = settings.getByRole('listitem', { name: 'E2E標籤分類' })
  await expect(trashEntry).toBeVisible()
  await expect(trashEntry).toContainText('標籤')
  await expect(trashEntry).toContainText('來源：刪除標籤')

  await trashEntry.getByRole('button', { name: '還原', exact: true }).click()
  await expect(page.getByText('已還原「E2E標籤分類」')).toBeVisible()
  await expect(trashEntry).toBeHidden()

  await expect.poll(() => mock.querySql<{ name: string }>('SELECT name FROM tags WHERE name = ?', ['E2E標籤分類'])).toHaveLength(1)
  await expect.poll(() => mock.querySql<{ deleted: number }>('SELECT deleted FROM marks WHERE id = 10')).toEqual([{ deleted: 0 }])
})

test('AC #1d：畫布軟刪除 → 最近刪除（畫布）→ 還原回到畫布清單', async ({ page }) => {
  await page.goto('/core/main')
  await waitForMainBoot(page)

  await page.getByRole('button', { name: '整理', exact: true }).click()
  const knowledgeRegion = page.getByRole('region', { name: '整理' })
  await expect(knowledgeRegion).toBeVisible()

  await knowledgeRegion.getByRole('tab', { name: '畫布', exact: true }).click()
  await knowledgeRegion.getByRole('button', { name: '新增畫布', exact: true }).first().click()
  await page.getByRole('menuitem', { name: '空白畫布', exact: true }).click()

  // 建立後如被開啟到畫布頁，點回整理即可操作畫布清單右鍵刪除
  await page.getByRole('button', { name: '整理', exact: true }).click()
  await knowledgeRegion.getByRole('tab', { name: '畫布', exact: true }).click()

  const canvasItem = knowledgeRegion.getByText('空白畫布').first()
  await expect(canvasItem).toBeVisible()
  await canvasItem.click({ button: 'right' })

  await page.getByRole('menuitem', { name: '刪除畫布', exact: true }).click()
  const confirmDialog = page.getByRole('alertdialog', { name: '刪除這張畫布？' })
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: '移到最近刪除', exact: true }).click()

  await expect(confirmDialog).toBeHidden()
  await expect(knowledgeRegion.getByText('空白畫布')).toBeHidden()
  await expect.poll(() => mock.querySql<{ deletedAt: number | null }>('SELECT deletedAt FROM canvases WHERE title = ?', ['空白畫布']).map(r => r.deletedAt !== null)).toEqual([true])

  const settings = await openRecentlyDeleted(page)
  const categories = settings.getByRole('tablist', { name: '最近刪除分類' })
  await categories.getByRole('tab', { name: '畫布', exact: true }).click()

  const trashEntry = settings.getByRole('listitem', { name: '空白畫布' })
  await expect(trashEntry).toBeVisible()
  await expect(trashEntry).toContainText('畫布')
  await expect(trashEntry).toContainText('來源：畫布側欄')

  await trashEntry.getByRole('button', { name: '還原', exact: true }).click()
  await expect(page.getByText('已還原「空白畫布」')).toBeVisible()
  await expect(trashEntry).toBeHidden()

  await closeSettingsDialog(settings)
  await page.getByRole('button', { name: '整理', exact: true }).click()
  const reopenedKnowledge = page.getByRole('region', { name: '整理' })
  await expect(reopenedKnowledge).toBeVisible()
  await reopenedKnowledge.getByRole('tab', { name: '畫布', exact: true }).click()
  await expect(reopenedKnowledge.getByText('空白畫布').first()).toBeVisible()
  await expect.poll(() => mock.querySql<{ deletedAt: number | null }>('SELECT deletedAt FROM canvases WHERE title = ?', ['空白畫布'])).toEqual([{ deletedAt: null }])
})

test('AC #1e：對話串刪除 → 最近刪除（對話）→ 還原回到歷史對話選單', async ({ page }) => {
  await page.goto('/core/main')
  await waitForMainBoot(page)
  await waitForDbReady()

  const now = Date.now()
  mock.execSql(
    `INSERT INTO conversations (id, title, createdAt, updatedAt, messageCount, isPinned, syncId, syncUpdatedAt, deletedAt)
     VALUES (?, ?, ?, ?, 1, 0, ?, ?, NULL)`,
    [20, 'E2E 待刪除對話', now, now, 'e2e-conv-20', now]
  )
  mock.execSql(
    `INSERT INTO chats (id, tagId, content, role, type, inserted, createdAt, conversationId, syncId, syncUpdatedAt)
     VALUES (?, 1, ?, 'user', 'chat', 0, ?, ?, ?, ?)`,
    [20, '測試對話軟刪除與還原', now, 20, 'e2e-chat-20', now]
  )

  await page.reload()
  await waitForMainBoot(page)

  const historyTrigger = page.getByRole('button', { name: /E2E 待刪除對話/ })
  await expect(historyTrigger).toBeVisible()
  await historyTrigger.click()

  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: /E2E 待刪除對話/ })).toBeVisible()
  await menu.getByRole('button', { name: '刪除對話', exact: true }).click()

  const confirmDialog = page.getByRole('alertdialog', { name: '確定要刪除這段對話嗎？' })
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: '移到最近刪除', exact: true }).click()

  await expect(confirmDialog).toBeHidden()
  await expect.poll(() => mock.querySql<{ deletedAt: number | null }>('SELECT deletedAt FROM conversations WHERE id = 20').map(r => r.deletedAt !== null)).toEqual([true])

  const settings = await openRecentlyDeleted(page)
  const categories = settings.getByRole('tablist', { name: '最近刪除分類' })
  await categories.getByRole('tab', { name: '對話', exact: true }).click()

  const trashEntry = settings.getByRole('listitem', { name: 'E2E 待刪除對話' })
  await expect(trashEntry).toBeVisible()
  await expect(trashEntry).toContainText('對話')
  await expect(trashEntry).toContainText('來源：對話標題列')

  await trashEntry.getByRole('button', { name: '還原', exact: true }).click()
  await expect(page.getByText('已還原「E2E 待刪除對話」')).toBeVisible()
  await expect(trashEntry).toBeHidden()

  await closeSettingsDialog(settings)
  await expect.poll(() => mock.querySql<{ deletedAt: number | null }>('SELECT deletedAt FROM conversations WHERE id = 20')).toEqual([{ deletedAt: null }])

  await page.getByRole('button', { name: '新對話', exact: true, disabled: false }).click()
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /E2E 待刪除對話/ })).toBeVisible()
})

test('AC #2：永久刪除二次確認清除資料庫與 .almanac-trash；超過 30 天重啟自動清除到期項目', async ({ page }) => {
  mock.writeVaultFile('永久刪除測試.md', '# 永久刪除測試\n\n手動確認永久清除。')
  mock.writeVaultFile('逾期自動清除.md', '# 逾期自動清除\n\n31 天後重啟應自動清除。')
  await page.goto('/core/main')
  await waitForMainBoot(page)

  const tree = await ensureNotesTreeExpanded(page)
  for (const title of ['永久刪除測試', '逾期自動清除']) {
    const item = tree.getByRole('treeitem', { name: new RegExp(title) })
    await expect(item).toBeVisible()
    await item.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /刪除/ }).click()
    await expect(item).toBeHidden()
  }

  await expect.poll(() => mock.listVaultFiles({ includeHidden: true }).filter(p => p.startsWith('.almanac-trash/')).length).toBe(2)

  const settings = await openRecentlyDeleted(page)
  const categories = settings.getByRole('tablist', { name: '最近刪除分類' })
  await categories.getByRole('tab', { name: '筆記與資料夾', exact: true }).click()

  const manualItem = settings.getByRole('listitem', { name: '永久刪除測試.md' })
  const expiredItem = settings.getByRole('listitem', { name: '逾期自動清除.md' })
  await expect(manualItem).toContainText('剩餘 30 天')
  await expect(expiredItem).toContainText('剩餘 30 天')

  await manualItem.getByRole('button', { name: '永久刪除', exact: true }).click()
  const confirmDialog = page.getByRole('alertdialog', { name: '要永久刪除這個項目嗎？' })
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: '永久刪除', exact: true }).click()

  await expect(confirmDialog).toBeHidden()
  await expect(page.getByText('已永久刪除「永久刪除測試.md」')).toBeVisible()
  await expect(manualItem).toBeHidden()
  await expect.poll(() => mock.querySql('SELECT title FROM trash_items')).toEqual([{ title: '逾期自動清除.md' }])
  await expect.poll(() => mock.listVaultFiles({ includeHidden: true }).filter(p => p.startsWith('.almanac-trash/')).length).toBe(1)

  await closeSettingsDialog(settings)

  // 快轉虛擬時鐘超過 30 天並重新啟動頁面，驗證 initTrashAutoPurgeRuntime 自動清除到期項目
  await mock.advanceDays(page, 31)
  await page.reload()
  await waitForMainBoot(page)

  await expect.poll(() => mock.querySql('SELECT id FROM trash_items')).toHaveLength(0)
  await expect.poll(() => mock.listVaultFiles({ includeHidden: true }).filter(p => p.startsWith('.almanac-trash/')).length).toBe(0)

  const reopenedSettings = await openRecentlyDeleted(page)
  await expect(reopenedSettings.getByText('最近刪除是空的')).toBeVisible()
})

test('AC #3：外部 MCP（顧問）刪除筆記 → 最近刪除顯示刪除者/來源 → 設定活動紀錄顯示顧問紀錄', async ({ page }) => {
  mock.writeVaultFile('顧問待刪筆記.md', '# 顧問待刪筆記\n\n交由外部 MCP 刪除以驗證歸屬與活動紀錄。')
  await page.goto('/core/main')
  await waitForMainBoot(page)

  await expect.poll(() => mock.isLocalMcpReady()).toBe(true)

  const mcpRes = await mock.callLocalMcpTool(
    page,
    'note_delete',
    { filePath: '顧問待刪筆記.md' },
    { id: 'e2e-advisor-1', name: 'Claude Desktop' }
  )
  expect(mcpRes.ok).toBe(true)
  await expect.poll(() => mock.fileExists('顧問待刪筆記.md')).toBe(false)

  const settings = await openRecentlyDeleted(page)
  const trashEntry = settings.getByRole('listitem', { name: '顧問待刪筆記.md' })
  await expect(trashEntry).toBeVisible()
  await expect(trashEntry).toContainText('刪除者：Claude Desktop · 顧問 / MCP')
  await expect(trashEntry).toContainText('來源：本機 MCP')

  await settings.getByRole('tab', { name: '常規設定', exact: true }).click()
  const generalPanel = settings.getByRole('tabpanel', { name: '常規設定', exact: true })
  const activityList = generalPanel.getByRole('list', { name: '活動紀錄' })
  await expect(activityList).toBeVisible()

  const advisorEntry = activityList.getByRole('listitem').filter({ hasText: 'Claude Desktop' }).first()
  await expect(advisorEntry).toBeVisible()
  await expect(advisorEntry).toContainText('顧問')
  await expect(advisorEntry).toContainText('刪除')
  await expect(advisorEntry).toContainText('顧問待刪筆記.md')
  await expect(advisorEntry).toContainText('外部 MCP note_delete')

  const actorFilter = generalPanel.getByRole('combobox', { name: '發起的夥伴' })
  if (await actorFilter.isVisible()) {
    await actorFilter.selectOption({ label: /Claude Desktop/ })
    await expect(advisorEntry).toBeVisible()
  }
})
