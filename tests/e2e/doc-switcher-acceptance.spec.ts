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

test('wikilink 建議框出現在游標範圍內', async ({ page }) => {
  for (const name of ['原子習慣', '番茄鐘']) await openNote(page, name)
  await page.getByText('番茄鐘的內容。').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[[原子')
  const option = page.getByRole('option', { name: /原子習慣/ })
  await expect(option).toBeVisible()
  const optionBox = (await option.boundingBox())!
  const lineBox = (await page.getByText('番茄鐘的內容。').boundingBox())!
  expect(optionBox.x).toBeGreaterThanOrEqual(lineBox.x - 8)
  // 建議框貼著輸入位置（「[[原子」之後）；容器有 transform 時會整個偏掉約一個編輯區左緣的距離
  expect(optionBox.x).toBeLessThanOrEqual(lineBox.x + 120)
  expect(Math.abs(optionBox.y - lineBox.y)).toBeLessThan(288 + 60)
  await page.keyboard.press('Escape')
})

test('樣式 B 切換時內容從左淡入，結束後容器不留 transform', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  for (const name of ['原子習慣', '番茄鐘']) await openNote(page, name)
  await page.getByRole('tablist', { name: '已開啟的文件' }).getByRole('tab', { name: /原子習慣/ }).click()
  const fading = await page.evaluate(() => document.getAnimations().some(animation => {
    const effect = animation.effect as KeyframeEffect | null
    return Boolean(effect?.getKeyframes().some(frame => String(frame.transform).includes('translateX(-16px)')))
  }))
  expect(fading).toBe(true)
  await page.waitForTimeout(500)
  const leftover = await page.evaluate(() => document.getAnimations().filter(animation => {
    const effect = animation.effect as KeyframeEffect | null
    return Boolean(effect?.getKeyframes().some(frame => String(frame.transform).includes('translateX(-16px)')))
  }).length)
  expect(leftover).toBe(0)
})

for (const style of ['stack', 'fan'] as const) {
  test(`減少動態效果（${style}）：展開疊卡沒有過場動畫`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(value => localStorage.setItem('almanac:doc-switcher-style', value), style)
    await page.reload()
    await waitForMainBoot(page)
    for (const name of ['原子習慣', '番茄鐘']) await openNote(page, name)
    await page.getByRole('button', { name: '展開疊卡' }).click()
    const back = page.getByRole('button', { name: /^原子習慣，第 \d+ 張/ })
    await expect(back).toBeVisible()
    expect(await back.evaluate(el => (el as HTMLElement).style.transition)).toBe('none')
  })
}

test('右鍵選單項目完整：B 的標籤與 A 的後面的卡', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  for (const name of ['原子習慣', '番茄鐘']) await openNote(page, name)
  const expectItems = async () => {
    for (const label of ['關閉', '關閉其他', '關閉全部', '固定分頁', '移動到新視窗']) {
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
    }
    await page.keyboard.press('Escape')
  }
  await page.getByRole('tablist', { name: '已開啟的文件' }).getByRole('tab', { name: /原子習慣/ }).click({ button: 'right' })
  await expectItems()

  await page.evaluate(() => localStorage.setItem('almanac:doc-switcher-style', 'stack'))
  await page.reload()
  await waitForMainBoot(page)
  await openNote(page, '番茄鐘')
  await page.getByRole('button', { name: '展開疊卡' }).click()
  await page.getByRole('button', { name: /^原子習慣，第 \d+ 張/ }).click({ button: 'right', position: { x: 80, y: 12 } })
  await expectItems()
})

test('暗色主題下三種樣式截圖', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => localStorage.setItem('theme', 'dark'))
  for (const style of ['folder', 'stack', 'fan'] as const) {
    await page.evaluate(value => localStorage.setItem('almanac:doc-switcher-style', value), style)
    await page.reload()
    await waitForMainBoot(page)
    for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)
    if (style !== 'folder') await page.getByRole('button', { name: '展開疊卡' }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: test.info().outputPath(`dark-${style}.png`) })
  }
})

test('切回 classic 介面：沒有文件切換器，回到上游分頁列', async ({ page }) => {
  for (const name of ['原子習慣', '番茄鐘']) await openNote(page, name)
  await page.getByRole('button', { name: '設定', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '設定' })
  await settings.getByRole('tab', { name: '常規設定', exact: true }).click()
  await settings.getByRole('switch', { name: '新介面（V3）' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tablist', { name: '已開啟的文件' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '展開疊卡' })).toHaveCount(0)
  await page.waitForTimeout(400)
  await page.screenshot({ path: test.info().outputPath('classic.png') })
})
