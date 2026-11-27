import { expect, test, type Locator, type Page } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from '../tauri-mock'

// ALMNC-94.5：主要流程關鍵畫面的截圖比對（淺色、深色各一份基準）。
// 跑法與何時更新基準見 AGENTS.md「截圖比對」一節；基準以 macOS 產生，存在 __screenshots__/darwin/。
//
// 穩定化：
// - 視窗大小固定（playwright.config.ts 的 viewport），deviceScaleFactor 1、時區 Asia/Taipei。
// - 時間固定：page.clock.setFixedTime 讓 Date.now()／new Date() 一律回傳 FIXED_NOW（計時器照常跑）；
//   tauri-mock 的虛擬時鐘位移維持 0，所以 App 看到的「今天」就是 FIXED_NOW。
// - 動畫與游標：config 的 toHaveScreenshot 預設 animations: 'disabled'、caret: 'hide'。
// - 字型：截圖前等 document.fonts.ready，並確認所有 @font-face 都已載入完畢。
// - 會變的區塊用 mask 蓋掉：toast（出現時機不固定）、相對時間（「剛剛」「3 分鐘前」）。
//   日期、週次、時間軸的「現在」線由固定時間決定，屬於要比對的畫面，不遮。

const FIXED_NOW = new Date('2026-03-12T10:30:00+08:00')

const SCHEMES = ['light', 'dark'] as const

let mock: TauriMockController
let pageErrors: Error[] = []

async function waitForFonts(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await expect.poll(() => page.evaluate(() => [...document.fonts].filter(f => f.status === 'loading').length)).toBe(0)
}

async function expectScheme(page: Page, scheme: (typeof SCHEMES)[number]) {
  // next-themes（defaultTheme="system"）依 prefers-color-scheme 在 <html> 加上 dark／light class；
  // 確認 App 真的換了主題，而不只是瀏覽器回報的偏好。
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(scheme === 'dark')
}

async function settle(page: Page, scheme: (typeof SCHEMES)[number]) {
  // 滑鼠停在剛點的位置會讓底下的項目出現 hover 樣式（例如設定視窗捲動後換了一列），移到左上角的空白處。
  await page.mouse.move(1, 1)
  await expectScheme(page, scheme)
  await waitForFonts(page)
  // 讓啟動後的非同步 render（例如 toast 消失、清單載入）落定
  await page.waitForTimeout(300)
}

function volatileRegions(page: Page): Locator[] {
  return [page.getByRole('region', { name: /^Notifications/ }).getByRole('listitem')]
}

async function snap(page: Page, name: string, mask: Locator[] = []) {
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: [...volatileRegions(page), ...mask] })
}

async function seedContent() {
  mock.writeVaultFile('閱讀筆記/複利學習.md', '# 複利學習\n\n每天把核心觀念寫成獨立卡片，一年後回顧依然受用。\n')
  mock.writeVaultFile('專案規劃.md', '# 專案規劃\n\n- 確認範圍\n- 排定里程碑\n')
}

async function seedCanvas() {
  await expect.poll(() =>
    mock.querySql<{ name: string }>("select name from sqlite_master where type='table' and name='canvases'").length
  ).toBe(1)
  const ts = FIXED_NOW.getTime()
  mock.execSql(
    `insert into canvases (id, title, canvasType, schemaVersion, content, createdAt, updatedAt)
     values (?, ?, 'blank', 1, ?, ?, ?)`,
    ['visual-roadmap', '產品路線圖', JSON.stringify({ nodes: [], edges: [] }), ts, ts]
  )
}

for (const scheme of SCHEMES) {
  test.describe(`截圖比對（${scheme === 'light' ? '淺色' : '深色'}）`, () => {
    test.use({ colorScheme: scheme })

    test.beforeEach(async ({ page }) => {
      pageErrors = []
      page.on('pageerror', error => {
        pageErrors.push(error)
      })
      await page.clock.setFixedTime(FIXED_NOW)
      mock = await setupTauriMock(page)
      await seedContent()
      await page.goto('/core/main')
      await waitForMainBoot(page)
      // 啟動後會把筆記庫裡既有的兩篇筆記轉成一張「舊筆記 2 則」待審卡（非同步），側欄工作台跟著出現「1」。
      // 等它出現再截圖，否則有時截到有徽章、有時沒有。
      await expect(page.getByRole('button', { name: '工作台 1 件', exact: true })).toBeVisible()
    })

    test.afterEach(() => {
      mock?.dispose()
      expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0)
    })

    test('今天', async ({ page }) => {
      await page.getByRole('button', { name: '今天', exact: true }).click()
      await expect(page.getByRole('region', { name: '今天' })).toBeVisible()
      await settle(page, scheme)
      await snap(page, `today-${scheme}`)
    })

    test('工作台', async ({ page }) => {
      await page.getByRole('button', { name: '工作台 1 件', exact: true }).click()
      const region = page.getByRole('region', { name: '工作台' })
      await expect(region).toBeVisible()
      await expect(region.getByText('舊筆記 2 則')).toBeVisible()
      await settle(page, scheme)
      // 待審項目右側的相對時間（「剛剛」…）
      await snap(page, `workbench-${scheme}`, [region.getByText('剛剛', { exact: true })])
    })

    test('整理：畫布分頁', async ({ page }) => {
      await seedCanvas()
      await page.getByRole('button', { name: '整理', exact: true }).click()
      const region = page.getByRole('region', { name: '整理' })
      await expect(region).toBeVisible()
      await region.getByRole('tab', { name: '畫布', exact: true }).click()
      await expect(region.getByText('產品路線圖')).toBeVisible()
      await settle(page, scheme)
      await snap(page, `knowledge-canvas-${scheme}`)
    })

    test('整理：標籤分頁', async ({ page }) => {
      await page.getByRole('button', { name: '整理', exact: true }).click()
      const region = page.getByRole('region', { name: '整理' })
      await expect(region).toBeVisible()
      const tab = region.getByRole('tab', { name: '標籤', exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await settle(page, scheme)
      await snap(page, `knowledge-tags-${scheme}`)
    })

    test('對話頁', async ({ page }) => {
      await page.getByRole('button', { name: '對話', exact: true }).click()
      await settle(page, scheme)
      await snap(page, `chat-${scheme}`)
    })

    test('命令面板', async ({ page }) => {
      await page.getByRole('button', { name: '今天', exact: true }).click()
      await expect(page.getByRole('region', { name: '今天' })).toBeVisible()
      await page.keyboard.press('ControlOrMeta+k')
      const palette = page.getByRole('dialog', { name: '命令面板' })
      await expect(palette).toBeVisible()
      await settle(page, scheme)
      await snap(page, `command-palette-${scheme}`)
    })

    test('設定視窗', async ({ page }) => {
      await page.getByRole('button', { name: '設定', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '設定' })
      await expect(dialog).toBeVisible()
      const tab = dialog.getByRole('tab', { name: '常規設定', exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await settle(page, scheme)
      await snap(page, `settings-${scheme}`)
    })

    test('最近刪除', async ({ page }) => {
      await page.getByRole('button', { name: '最近刪除', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '設定', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('tablist', { name: '最近刪除分類' })).toBeVisible()
      await settle(page, scheme)
      await snap(page, `recently-deleted-${scheme}`)
    })
  })
}
