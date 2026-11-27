// Fork（almanac ALMNC-97）：V3 文件切換器——可以同時開多篇，用設定選的樣式切換（預設 B 資料夾標籤）。
import { expect, test, type Page } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

const NOTES = [
  ['知識/原子習慣.md', '# 原子習慣\n\n每天進步 1%。\n'],
  ['知識/番茄鐘.md', '# 番茄鐘\n\n一次 25 分鐘。\n'],
  ['知識/卡片盒.md', '# 卡片盒\n\n一張卡一個想法。\n'],
] as const

async function openNote(page: Page, name: string) {
  const tree = page.getByRole('tree', { name: '工作區檔案' })
  const expand = page.getByRole('button', { name: '展開我的筆記', exact: true })
  await expect(tree.or(expand)).toBeVisible()
  if (await expand.isVisible()) await expand.click()
  const folder = tree.getByRole('treeitem', { name: '知識', exact: true })
  if ((await folder.getAttribute('aria-expanded')) === 'false') await folder.click()
  await tree.getByRole('treeitem', { name: new RegExp(name) }).dblclick()
  await expect(page.getByRole('textbox', { name: '標題', exact: true })).toHaveValue(name)
}

test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => { pageErrors.push(error) })
  mock = await setupTauriMock(page)
  for (const [file, body] of NOTES) mock.writeVaultFile(file, body)
  await page.goto('/core/main')
  await waitForMainBoot(page)
})

test.afterEach(() => {
  mock?.dispose()
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0)
})

test('預設樣式 B：開三篇都留著，最近開的排前面，點標籤切回去', async ({ page }) => {
  await openNote(page, '原子習慣')
  await openNote(page, '番茄鐘')
  await openNote(page, '卡片盒')

  const tabs = page.getByRole('tablist', { name: '已開啟的文件' })
  await expect(tabs.getByRole('tab', { name: /原子習慣/ })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /番茄鐘/ })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /卡片盒/ })).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: test.info().outputPath('folder-tabs.png') })

  await tabs.getByRole('tab', { name: /原子習慣/ }).click()
  await expect(page.getByRole('textbox', { name: '標題', exact: true })).toHaveValue('原子習慣')
  await expect(tabs.getByRole('tab', { name: /原子習慣/ })).toHaveAttribute('aria-selected', 'true')
})
