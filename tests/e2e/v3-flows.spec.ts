import { expect, test } from '@playwright/test'
import { setupTauriMock, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => {
    pageErrors.push(error)
  })
  mock = await setupTauriMock(page)
  await page.goto('/core/main')
  // Wait for primary V3 sidebar navigation to mount
  await expect(page.getByRole('button', { name: '新增', exact: true, disabled: false })).toBeVisible()
})

test.afterEach(() => {
  mock?.dispose()
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0)
})

test('V3 流程一：新增資料源 → 工作台卡片 → 接受並寫入筆記檔', async ({ page }) => {
  // 1. 透過側欄「＋」選單開啟「新增資料源」
  await page.getByRole('button', { name: '新增', exact: true, disabled: false }).click()
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
  await page.getByRole('button', { name: '新增', exact: true, disabled: false }).click()
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
