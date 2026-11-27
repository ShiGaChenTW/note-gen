import { expect, test, type Page } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from './tauri-mock'

// 側欄頂端的「新增」（＋）選單。右側 AI 對話輸入框也有一顆同名的「新增」（附加）按鈕，
// 它稍晚才啟用，所以不能用 disabled 篩選來區分；側欄在 DOM 順序上排第一，和其他 spec 一樣取 first()。
function sidebarAddButton(page: Page) {
  return page.getByRole('button', { name: '新增', exact: true }).first()
}

let mock: TauriMockController
let pageErrors: Error[] = []

test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => {
    pageErrors.push(error)
  })
  mock = await setupTauriMock(page)
  await page.goto('/core/main')
  await waitForMainBoot(page)
})

test.afterEach(() => {
  mock?.dispose()
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0)
})

test('V3 流程一：新增資料源 → 工作台卡片 → 接受並寫入筆記檔', async ({ page }) => {
  // 1. 透過側欄「＋」選單開啟「新增資料源」
  await sidebarAddButton(page).click()
  await page.getByRole('menuitem', { name: /新增資料源/ }).click()

  const dialog = page.getByRole('dialog', { name: '新增資料源' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('textbox').fill('E2E 複利學習筆記\n每天把核心觀念寫成獨立卡片，一年後回顧依然受用。')
  await dialog.getByRole('button', { name: /儲存文字/ }).click()

  // 儲存後自動跳轉工作台，等指揮官（mock AI）產生提案卡並切到「審核」分頁
  const workbenchRegion = page.getByRole('region', { name: '工作台' })
  await expect(workbenchRegion).toBeVisible()

  const reviewTab = workbenchRegion.getByRole('tab', { name: /審核\s*1/ })
  await expect(reviewTab).toBeVisible({ timeout: 20_000 })
  await reviewTab.click()

  const cardToggle = workbenchRegion.getByRole('button', { name: /E2E 複利學習筆記/ })
  await expect(cardToggle).toBeVisible()
  await cardToggle.click()
  await expect(cardToggle).toHaveAttribute('aria-expanded', 'true')

  // 接受提案並驗證提示訊息、卡片消失與真實檔案寫入暫存 vault
  await workbenchRegion.getByRole('button', { name: /接受/ }).first().click()
  await expect(page.getByText(/已接受「E2E 複利學習筆記」/)).toBeVisible()
  await expect(cardToggle).toBeHidden()

  await expect.poll(() => mock.listVaultFiles().filter(name => name.endsWith('.md')).length).toBeGreaterThan(0)
  const noteFile = mock.listVaultFiles().find(name => name.endsWith('.md'))
  expect(noteFile).toBeTruthy()
  expect(mock.readVaultFile(noteFile!)).toContain('E2E 複利學習筆記')
})

test('V3 流程二：工作台再次討論失敗時顯示錯誤並留住已輸入文字', async ({ page }) => {
  // 先透過真實新增資料源讓指揮官產生一張待決定卡片
  await sidebarAddButton(page).click()
  await page.getByRole('menuitem', { name: /新增資料源/ }).click()

  const dialog = page.getByRole('dialog', { name: '新增資料源' })
  await dialog.getByRole('textbox').fill('E2E 討論重試驗證筆記\n驗證失敗時文字框內容不能消失。')
  await dialog.getByRole('button', { name: /儲存文字/ }).click()

  const workbenchRegion = page.getByRole('region', { name: '工作台' })
  const reviewTab = workbenchRegion.getByRole('tab', { name: /審核\s*1/ })
  await expect(reviewTab).toBeVisible({ timeout: 20_000 })
  await reviewTab.click()

  const cardToggle = workbenchRegion.getByRole('button', { name: /E2E 討論重試驗證筆記/ })
  await cardToggle.click()

  // 設定下一次 AI 請求失敗，模擬再次討論送出失敗
  mock.setAiHandler(() => {
    throw new Error('Mock Commander AI error')
  })

  await workbenchRegion.getByRole('button', { name: /再次討論/ }).click()
  const draftInstruction = '請把標題縮短，並強調這是可重試的草稿。'
  const discussInput = workbenchRegion.getByRole('textbox', { name: '再次討論的說明' })
  await discussInput.fill(draftInstruction)
  await workbenchRegion.getByRole('button', { name: /送出並回到對話/ }).click()

  await expect(workbenchRegion.getByRole('alert')).toContainText('沒有送出，你寫的說明還在，可以再送一次。')
  await expect(discussInput).toBeVisible()
  await expect(discussInput).toHaveValue(draftInstruction)
})

test('V3 流程三：整理 → 畫布 → 新建空白畫布並開啟', async ({ page }) => {
  await page.getByRole('button', { name: '整理', exact: true }).click()

  const knowledgeRegion = page.getByRole('region', { name: '整理' })
  await expect(knowledgeRegion).toBeVisible()

  await knowledgeRegion.getByRole('tab', { name: '畫布', exact: true }).click()
  await knowledgeRegion.getByRole('button', { name: '新增畫布', exact: true }).first().click()
  await page.getByRole('menuitem', { name: '空白畫布', exact: true }).click()

  // 建立後應關閉覆蓋層並在主編輯區開啟畫布工具列
  await expect(page.getByRole('toolbar', { name: /工具/ })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => mock.querySql<{ id: string }>('select id from canvases').length).toBe(1)
})

// ALMNC-93：不經過整理頁的畫布入口。
test('V3 流程三之二：側欄＋ → 新增畫布 → 直接開啟 → 返回今天 → 再開回畫布', async ({ page }) => {
  // 從「今天」出發，確認建立畫布後覆蓋層收起、畫布開在編輯區
  await page.getByRole('button', { name: '今天', exact: true }).click()
  const today = page.getByRole('region', { name: '今天' })
  await expect(today).toBeVisible()

  // 今天頁自己也有一顆「新增」；側欄在 DOM 前面，取第一顆就是側欄的「＋」
  await sidebarAddButton(page).click()
  await page.getByRole('menuitem', { name: '新增畫布', exact: true }).click()

  const canvasToolbar = page.getByRole('toolbar', { name: '畫布工具', exact: true })
  await expect(canvasToolbar).toBeVisible({ timeout: 15_000 })
  await expect(today).toBeHidden()
  await expect.poll(() => mock.querySql<{ title: string }>('select title from canvases').map(row => row.title)).toEqual(['空白畫布'])

  // 返回：回到剛才的「今天」，再從命令面板的最近畫布回到同一張畫布
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await expect(today).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: '命令面板' })
  await palette.getByRole('option', { name: '開啟畫布：空白畫布' }).click()
  await expect(palette).toBeHidden()
  await expect(today).toBeHidden()
  await expect(canvasToolbar).toBeVisible()
})

test('V3 流程三之三：⌘K 命令面板列出既有畫布並直接開啟', async ({ page }) => {
  await expect.poll(() =>
    mock.querySql<{ name: string }>("select name from sqlite_master where type='table' and name='canvases'").length
  ).toBe(1)
  const now = Date.now()
  mock.execSql(
    `insert into canvases (id, title, canvasType, schemaVersion, content, createdAt, updatedAt)
     values (?, ?, 'blank', 1, ?, ?, ?)`,
    ['e2e-roadmap', 'E2E 產品路線圖', JSON.stringify({ nodes: [], edges: [] }), now, now]
  )

  // 沒進過整理頁：面板打開時才讀畫布清單
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: '命令面板' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('group', { name: '畫布' }).getByRole('option', { name: '開啟畫布：E2E 產品路線圖' })).toBeVisible()

  // 也能用名稱搜尋
  await palette.getByRole('combobox').fill('路線圖')
  await palette.getByRole('option', { name: '開啟畫布：E2E 產品路線圖' }).click()

  await expect(palette).toBeHidden()
  await expect(page.getByRole('toolbar', { name: '畫布工具', exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('region', { name: '今天' })).toBeHidden()
  await expect(page.getByRole('region', { name: '整理' })).toBeHidden()
})

test('V3 流程四：開啟設定視窗並切換多個設定分頁', async ({ page }) => {
  await page.getByRole('button', { name: '設定', exact: true }).click()

  const settingsDialog = page.getByRole('dialog', { name: '設定' })
  await expect(settingsDialog).toBeVisible()

  const tabsToVisit = [
    { tabName: '常規設定', expectedText: /常規設定/ },
    { tabName: '模型服務', expectedText: /模型平台/ },
    { tabName: 'MCP', expectedText: /MCP/ },
    { tabName: '最近刪除', expectedText: /所有刪除的筆記庫檔案/ },
  ]

  for (const { tabName, expectedText } of tabsToVisit) {
    const tab = settingsDialog.getByRole('tab', { name: tabName, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(settingsDialog.getByRole('tabpanel', { name: tabName, exact: true })).toContainText(expectedText)
  }
})
