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

// ALMNC-97.2 AC#3：選取文字的浮動選單（bubble menu）在最前面那張卡內位置正確。
// 浮動選單用 position: fixed＋視口座標；包住編輯器的任何祖先若有 transform 或 contain，fixed 會改以那個祖先為基準，
// 選單會整個偏掉約「編輯區左上角」的距離（水平數百 px、垂直上百 px），下面的容差抓得到。
for (const style of ['stack', 'folder', 'fan'] as const) {
  test(`選取文字的浮動選單落在選取範圍旁（${style}），編輯器的祖先沒有 transform 和 contain`, async ({ page }) => {
    await page.evaluate(value => localStorage.setItem('almanac:doc-switcher-style', value), style)
    await page.reload()
    await waitForMainBoot(page)
    for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)
    if (style === 'folder') await expect(page.getByRole('tablist', { name: '已開啟的文件' })).toBeVisible()
    else await expect(page.getByRole('button', { name: '展開疊卡' })).toBeVisible()

    const line = page.getByText('卡片盒的內容。', { exact: true })
    await expect(line).toBeVisible()
    // 等切換的淡入動畫跑完再量 computed style（動畫中內容會短暫 translateX）。
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'))
    const offenders = await line.evaluate(el => {
      const found: string[] = []
      for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const computed = getComputedStyle(node)
        if (computed.transform !== 'none' || computed.contain !== 'none') {
          found.push(`${node.tagName.toLowerCase()}.${node.className}: transform=${computed.transform} contain=${computed.contain}`)
        }
      }
      return found
    })
    expect(offenders, offenders.join('\n')).toEqual([])

    // 用滑鼠從行首拖到行尾選取（macOS 的 Home／End 不移動游標，鍵盤選取在各平台不一致）。
    const dragBox = (await line.boundingBox())!
    const midY = dragBox.y + dragBox.height / 2
    await page.mouse.move(dragBox.x + 1, midY)
    await page.mouse.down()
    await page.mouse.move(dragBox.x + dragBox.width / 2, midY, { steps: 4 })
    await page.mouse.move(dragBox.x + dragBox.width - 1, midY, { steps: 4 })
    await page.mouse.up()
    const bold = page.getByRole('button', { name: '粗體', exact: true })
    await expect(bold).toBeVisible()
    // 選單有 150ms 的 transform 過場（第一次從 0,0 移過來），等位置穩定。
    let boldBox = (await bold.boundingBox())!
    await expect.poll(async () => {
      const previous = boldBox
      boldBox = (await bold.boundingBox())!
      return Math.abs(previous.x - boldBox.x) + Math.abs(previous.y - boldBox.y)
    }).toBe(0)
    const lineBox = (await line.boundingBox())!

    // 選單左緣對齊選取起點（行首），粗體在選單前段；容器有 transform 時會往右偏掉一個側欄寬（約 250px 以上）。
    expect(boldBox.x).toBeGreaterThanOrEqual(lineBox.x - 8)
    expect(boldBox.x).toBeLessThanOrEqual(lineBox.x + 160)
    // 垂直：放在選取範圍正上方（空間不夠時翻到下方），間距 8px，選單本身約 40px 高。
    const gapAbove = lineBox.y - (boldBox.y + boldBox.height)
    const gapBelow = boldBox.y - (lineBox.y + lineBox.height)
    const nearAbove = gapAbove >= 0 && gapAbove <= 40
    const nearBelow = gapBelow >= 0 && gapBelow <= 40
    expect(nearAbove || nearBelow, `bold=${JSON.stringify(boldBox)} line=${JSON.stringify(lineBox)}`).toBe(true)
    // 也不能蓋到切換器上（疊卡／標籤列）
    const switcher = style === 'folder'
      ? page.getByRole('tablist', { name: '已開啟的文件' })
      : page.getByRole('button', { name: '展開疊卡' })
    const switcherBox = (await switcher.boundingBox())!
    expect(boldBox.y).toBeGreaterThanOrEqual(switcherBox.y + switcherBox.height - 1)
  })
}

// ALMNC-97.5 AC#4：開著多篇（切換器在）時，⇧⌘7／8／9（編號清單／項目清單／待辦清單）照常作用、不會切換文件。
// 用實體鍵位（Digit7…）按，瀏覽器送出的 key 是 & * (，和真的鍵盤一樣；TipTap 依 keyCode 對回 Mod-Shift-7/8/9。
test('⇧⌘7／8／9 照常切換清單格式，不會切換文件', async ({ page }) => {
  for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)
  const title = page.getByRole('textbox', { name: '標題', exact: true })
  const activeTab = page.getByRole('tablist', { name: '已開啟的文件' }).getByRole('tab', { name: /卡片盒/ })
  // TipTap 的 Mod 在 macOS 是 ⌘、其他平台是 Ctrl（CI 跑在 Linux）。
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const shortcut = async (code: string) => {
    await page.keyboard.down(mod)
    await page.keyboard.down('Shift')
    await page.keyboard.press(code)
    await page.keyboard.up('Shift')
    await page.keyboard.up(mod)
  }
  const saved = () => mock.readVaultFile('知識/卡片盒.md')

  // 第一次點擊只讓編輯器取得焦點（游標落在文件開頭，只開一篇時也一樣），再點一次才把游標放到這一段。
  const body = page.getByText('卡片盒的內容。', { exact: true })
  await body.click()
  await body.click()
  for (const [code, markdown] of [['Digit7', '1. 卡片盒的內容。'], ['Digit8', '- 卡片盒的內容。'], ['Digit9', '- [ ] 卡片盒的內容。']] as const) {
    await shortcut(code)
    await expect.poll(saved, { message: `${code} 之後存檔` }).toContain(markdown)
    await expect(title).toHaveValue('卡片盒')
    await expect(activeTab).toHaveAttribute('aria-selected', 'true')
    // 再按一次切回一般段落，下一個快捷鍵從段落開始
    await shortcut(code)
    await expect.poll(saved, { message: `${code} 再按一次之後存檔` }).not.toContain(markdown)
  }
})

test('⌘1～⌘9 都不會切到對應位置的分頁', async ({ page }) => {
  for (const name of ['原子習慣', '番茄鐘', '卡片盒']) await openNote(page, name)
  const title = page.getByRole('textbox', { name: '標題', exact: true })
  await page.getByText('卡片盒的內容。', { exact: true }).click()
  for (let digit = 1; digit <= 9; digit++) {
    await page.keyboard.press(`ControlOrMeta+${digit}`)
    await page.waitForTimeout(100)
    await expect(title).toHaveValue('卡片盒')
  }
  await expect(page.getByRole('tablist', { name: '已開啟的文件' }).getByRole('tab', { name: /卡片盒/ })).toHaveAttribute('aria-selected', 'true')
})
