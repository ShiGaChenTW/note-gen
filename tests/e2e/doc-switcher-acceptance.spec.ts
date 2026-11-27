// Fork（almanac ALMNC-97）：文件切換器驗收補測——設定頁切換樣式、減少動態效果、快捷鍵不衝突、
// 只有標題區的左右滑會切換、/ 選單位置正確、卸載後重新開回到原本捲動位置。
import { expect, test, type Page } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

const SHORT = ['原子習慣', '番茄鐘', '卡片盒', '間隔重複', '費曼學習法', '心流', '番茄工作法', '深度工作', '第二大腦']
const LONG_BODY = Array.from({ length: 160 }, (_, index) => `第 ${index + 1} 段：一段用來捲動的內容。`).join('\n\n')

async function openNote(page: Page, name: string) {
  const tree = page.getByRole('tree', { name: '工作區檔案' })
  const expand = page.getByRole('button', { name: '展開我的筆記', exact: true })
  await expect(tree.or(expand)).toBeVisible()
  if (await expand.isVisible()) await expand.click()
  const folder = tree.getByRole('treeitem', { name: '知識', exact: true })
  if ((await folder.getAttribute('aria-expanded')) === 'false') await folder.click()
  await tree.getByRole('treeitem', { name: new RegExp(`^${name}`) }).dblclick()
  await expect(page.getByRole('textbox', { name: '標題', exact: true })).toHaveValue(name)
}

test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => { pageErrors.push(error) })
  mock = await setupTauriMock(page)
  for (const name of SHORT) mock.writeVaultFile(`知識/${name}.md`, `# ${name}\n\n${name}的內容。\n`)
  mock.writeVaultFile('知識/長文.md', `# 長文\n\n${LONG_BODY}\n`)
  await page.goto('/core/main')
  await waitForMainBoot(page)
})

test.afterEach(() => {
  mock?.dispose()
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0)
})

test('設定 › 外觀切換文件切換樣式，立即生效並保存', async ({ page }) => {
  await openNote(page, '原子習慣')
  await openNote(page, '番茄鐘')
  await expect(page.getByRole('tablist', { name: '已開啟的文件' })).toBeVisible()

  await page.getByRole('button', { name: '設定', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '設定' })
  await settings.getByRole('tab', { name: '常規設定', exact: true }).click()
  const style = settings.getByRole('radiogroup', { name: '文件切換樣式' })
  await expect(style.getByRole('radio', { name: '資料夾標籤' })).toHaveAttribute('aria-checked', 'true')
  await style.getByRole('radio', { name: '上方疊列' }).click()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  await expect(page.getByRole('tablist', { name: '已開啟的文件' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '展開疊卡' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('almanac:doc-switcher-style'))).toBe('stack')
})

test('減少動態效果：點標籤直接切換，標籤沒有浮起或滑動', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1600, height: 900 })
  for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)
  const tabs = page.getByRole('tablist', { name: '已開啟的文件' })
  await tabs.getByRole('tab', { name: /原子習慣/ }).click()
  const transforms = await tabs.getByRole('tab').evaluateAll(els => els.map(el => (el as HTMLElement).style.transform))
  expect(transforms.every(value => value === '')).toBe(true)
  await expect(page.getByRole('textbox', { name: '標題', exact: true })).toHaveValue('原子習慣')
})

// ⇧⌘7/8/9（清單格式）在 headless E2E 裡本來就不會觸發（未按 ⌘2 前也一樣），這裡只驗 ⌘2；切換器只攔 ⌃Tab、Esc、放開 ⌃。
test('⌘2 不會切到第二張分頁', async ({ page }) => {
  for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)
  const title = page.getByRole('textbox', { name: '標題', exact: true })
  await page.getByText('卡片盒的內容。').click()
  await page.keyboard.press('ControlOrMeta+2')
  await page.waitForTimeout(300)
  await expect(title).toHaveValue('卡片盒')
  await expect(page.getByRole('tablist', { name: '已開啟的文件' }).getByRole('tab', { name: /卡片盒/ })).toHaveAttribute('aria-selected', 'true')
})

test('只有標題區的觸控板左右滑會切換，內文上的左右滑不會', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)
  const title = page.getByRole('textbox', { name: '標題', exact: true })

  await page.getByText('卡片盒的內容。').hover()
  await page.mouse.wheel(-200, 0)
  await page.waitForTimeout(300)
  await expect(title).toHaveValue('卡片盒')

  await page.getByRole('tablist', { name: '已開啟的文件' }).getByRole('tab', { name: /卡片盒/ }).hover()
  await page.mouse.wheel(-200, 0)
  await expect(title).toHaveValue('番茄鐘')
})

test('/ 選單出現在游標下方、編輯區內，不被切換器擋住', async ({ page }) => {
  for (const name of ['原子習慣', '番茄鐘']) await openNote(page, name)
  await page.getByText('番茄鐘的內容。').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  const item = page.getByText('續寫', { exact: true })
  await expect(item).toBeVisible()
  const itemBox = (await item.boundingBox())!
  const lineBox = (await page.getByText('番茄鐘的內容。').boundingBox())!
  const tabsBox = (await page.getByRole('tablist', { name: '已開啟的文件' }).boundingBox())!
  // 選單（寬 416px）從游標左緣開始，項目落在這個範圍內；下方空間不夠時會翻到上方，所以垂直只要求在游標上下一個選單高度內。
  // 包住編輯器的容器上若有 transform，position: fixed 會改以容器為基準，整個選單會偏掉約一個編輯區左緣的距離。
  expect(itemBox.x).toBeGreaterThanOrEqual(lineBox.x - 4)
  expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(lineBox.x + 416 + 8)
  expect(Math.abs(itemBox.y - lineBox.y)).toBeLessThan(296 + 40)
  expect(itemBox.y).toBeGreaterThan(tabsBox.y + tabsBox.height)
  await page.keyboard.press('Escape')
})

test('超過 8 張後最久沒看的那篇先卸載，再切回來時回到原本捲動位置', async ({ page }) => {
  await openNote(page, '長文')
  const last = page.getByText('第 160 段：一段用來捲動的內容。')
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  await page.waitForTimeout(800) // 捲動位置延遲存檔

  for (const name of SHORT.slice(0, 8)) await openNote(page, name)

  // 長文現在是第 9 久沒看（今天的日記也算一張），內容已卸載
  await expect(page.getByText('第 160 段：一段用來捲動的內容。')).toHaveCount(0)
  await openNote(page, '長文')
  await expect(page.getByText('第 160 段：一段用來捲動的內容。')).toBeInViewport()
})
