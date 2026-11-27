// Warm the Next dev server before the suite runs.
//
// `next dev --turbopack` compiles a route on its first request and each lazily imported client chunk
// (canvas, settings, workbench, threads, command palette, editor) the first time a browser asks for it.
// Without this, whichever test happens to open a surface first pays that cold compile inside its own
// 60 s budget, so the slow test moves around from run to run. Here a throwaway page (with its own mock
// state, discarded afterwards) walks the main surfaces once. Failures are only logged: the real tests
// still report anything that is actually broken.
import { chromium, expect, type FullConfig, type Page } from '@playwright/test'
import { setupTauriMock } from './tauri-mock'

const WARMUP_TIMEOUT_MS = 60_000

async function step(name: string, action: () => Promise<void>) {
  try {
    await action()
  } catch (error) {
    console.warn(`[e2e warmup] ${name} skipped:`, error instanceof Error ? error.message.split('\n')[0] : error)
  }
}

async function walkMainSurfaces(page: Page) {
  const nav = page.getByRole('navigation', { name: '主要導覽' })
  await expect(nav).toBeVisible({ timeout: WARMUP_TIMEOUT_MS })

  await step('editor', async () => {
    const tree = page.getByRole('tree', { name: '工作區檔案' })
    const expand = page.getByRole('button', { name: '展開我的筆記', exact: true })
    await expect(tree.or(expand)).toBeVisible({ timeout: WARMUP_TIMEOUT_MS })
    if (await expand.isVisible()) await expand.click()
    await tree.getByRole('treeitem', { name: /暖機筆記/ }).click({ timeout: WARMUP_TIMEOUT_MS })
    await expect(page.getByRole('toolbar', { name: '筆記工具列' })).toBeVisible({ timeout: WARMUP_TIMEOUT_MS })
  })

  // 導覽按鈕名稱後面可能帶待辦數（例如「工作台 1 件」），所以比對開頭。
  for (const surface of ['工作台', '對話', '今天']) {
    await step(surface, async () => {
      await nav.getByRole('button', { name: new RegExp(`^${surface}`) }).click({ timeout: WARMUP_TIMEOUT_MS })
      await expect(page.getByRole('region', { name: surface })).toBeVisible({ timeout: WARMUP_TIMEOUT_MS })
    })
  }

  await step('canvas', async () => {
    await page.getByRole('button', { name: '整理', exact: true }).click()
    const region = page.getByRole('region', { name: '整理' })
    await region.getByRole('tab', { name: '畫布', exact: true }).click({ timeout: WARMUP_TIMEOUT_MS })
    await region.getByRole('button', { name: '新增畫布', exact: true }).first().click({ timeout: WARMUP_TIMEOUT_MS })
    await page.getByRole('menuitem', { name: '空白畫布', exact: true }).click({ timeout: WARMUP_TIMEOUT_MS })
    await expect(page.getByRole('toolbar', { name: '畫布工具', exact: true })).toBeVisible({ timeout: WARMUP_TIMEOUT_MS })
  })

  await step('command palette', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: '命令面板' })
    await expect(palette).toBeVisible({ timeout: WARMUP_TIMEOUT_MS })
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden({ timeout: WARMUP_TIMEOUT_MS })
  })

  await step('settings', async () => {
    await page.getByRole('button', { name: '設定', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '設定' })
    await expect(settings).toBeVisible({ timeout: WARMUP_TIMEOUT_MS })
    for (const tab of ['常規設定', '模型服務', 'MCP', '最近刪除']) {
      await settings.getByRole('tab', { name: tab, exact: true }).click({ timeout: WARMUP_TIMEOUT_MS })
      await expect(settings.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible({ timeout: WARMUP_TIMEOUT_MS })
    }
  })
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3456'
  const started = Date.now()
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ baseURL, locale: 'zh-TW', viewport: { width: 1280, height: 860 } })
    const page = await context.newPage()
    const mock = await setupTauriMock(page)
    try {
      mock.writeVaultFile('暖機筆記.md', '# 暖機筆記\n\n只在暖機時用。\n')
      await page.goto('/core/main', { timeout: WARMUP_TIMEOUT_MS })
      await walkMainSurfaces(page)
    } catch (error) {
      console.warn('[e2e warmup] stopped early:', error instanceof Error ? error.message.split('\n')[0] : error)
    } finally {
      await context.close()
      mock.dispose()
    }
  } finally {
    await browser.close()
  }
  console.log(`[e2e warmup] dev server warmed in ${Math.round((Date.now() - started) / 1000)}s`)
}
