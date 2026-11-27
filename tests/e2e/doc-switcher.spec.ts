// Fork（almanac ALMNC-97）：V3 文件切換器——可以同時開多篇，用設定選的樣式切換（預設 B 資料夾標籤）。
import { expect, test, type Page } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

const NOTES = [
  ['知識/原子習慣.md', '# 原子習慣\n\n每天進步 1%。\n'],
  ['知識/番茄鐘.md', '# 番茄鐘\n\n一次 25 分鐘。\n'],
  ['知識/卡片盒.md', '# 卡片盒\n\n一張卡一個想法。\n'],
  ['知識/間隔重複.md', '# 間隔重複\n\n隔一段時間再複習。\n'],
  ['知識/費曼學習法.md', '# 費曼學習法\n\n用自己的話講給別人聽。\n'],
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
  await page.setViewportSize({ width: 1600, height: 900 })
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

test('樣式 B：放不下的分頁收進「更多」，從選單選的那張移到最前面', async ({ page }) => {
  for (const name of ['原子習慣', '番茄鐘', '卡片盒', '間隔重複', '費曼學習法']) await openNote(page, name)

  const tabs = page.getByRole('tablist', { name: '已開啟的文件' })
  await expect(tabs.getByRole('tab', { name: /費曼學習法/ })).toHaveAttribute('aria-selected', 'true')
  const more = page.getByRole('button', { name: /^更多 \d+/ })
  await expect(more).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /原子習慣/ })).toHaveCount(0)

  // 標籤切換的中途截圖：選到的那張浮起、滑向最前面
  await tabs.getByRole('tab').nth(1).click()
  await page.waitForTimeout(120)
  await page.screenshot({ path: test.info().outputPath('folder-tabs-switching.png'), clip: { x: 500, y: 30, width: 420, height: 80 } })

  await more.click()
  await page.getByRole('menuitem', { name: /原子習慣/ }).click()
  await expect(page.getByRole('textbox', { name: '標題', exact: true })).toHaveValue('原子習慣')
  await expect(tabs.getByRole('tab').first()).toHaveAccessibleName(/原子習慣/)
  await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: test.info().outputPath('folder-tabs-more.png') })
})

for (const [style, label] of [['stack', 'A 上方疊列'], ['fan', 'C 斜向錯開']] as const) {
  test(`樣式 ${label}：平常收合，按疊卡鈕展開，點後面的卡切換後自動收合`, async ({ page }) => {
    await page.evaluate(value => localStorage.setItem('almanac:doc-switcher-style', value), style)
    await page.reload()
    await waitForMainBoot(page)
    for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)

    const toggle = page.getByRole('button', { name: '展開疊卡' })
    await expect(toggle).toBeVisible()
    await expect(page.getByRole('button', { name: /^番茄鐘，第 \d+ 張/ })).toBeHidden()
    await page.screenshot({ path: test.info().outputPath(`${style}-collapsed.png`) })

    await toggle.click()
    await expect(page.getByRole('button', { name: '收合疊卡' })).toHaveAttribute('aria-expanded', 'true')
    const back = page.getByRole('button', { name: /^番茄鐘，第 \d+ 張/ })
    await expect(back).toBeVisible()
    await page.waitForTimeout(350)
    await page.screenshot({ path: test.info().outputPath(`${style}-expanded.png`) })

    await back.click({ position: { x: 80, y: 12 } }) // 後面的卡只露出上方 24px 標題列，中央被前面那張蓋住
    await expect(page.getByRole('textbox', { name: '標題', exact: true })).toHaveValue('番茄鐘')
    await expect(page.getByRole('button', { name: '展開疊卡' })).toHaveAttribute('aria-expanded', 'false')

    await page.getByRole('button', { name: '展開疊卡' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '展開疊卡' })).toHaveAttribute('aria-expanded', 'false')
  })
}

test('按住 ⌃ 連按 Tab 選卡，放開才切換；途中 Esc 取消', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)
  const title = page.getByRole('textbox', { name: '標題', exact: true })
  const tabs = page.getByRole('tablist', { name: '已開啟的文件' })

  // 最近使用：卡片盒 → 番茄鐘 → 原子習慣。按兩下 Tab 選到原子習慣，放開前不切換。
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(title).toHaveValue('卡片盒')
  await page.keyboard.up('Control')
  await expect(title).toHaveValue('原子習慣')
  await expect(tabs.getByRole('tab', { name: /原子習慣/ })).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  await page.keyboard.up('Control')
  await expect(title).toHaveValue('原子習慣')
})
