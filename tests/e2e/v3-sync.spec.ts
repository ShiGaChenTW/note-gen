import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from './tauri-mock'

// ALMNC-95.3：V3 同步的雙裝置 E2E（設計 2026-11-27_proposal_v3-sync-design.md 5.2 第三層）。
// 兩個 browser context＝兩台裝置 A、B，各有自己的 tauri-mock（note.db、store.json、筆記庫都分開），
// 同步方式都設成「雲端資料夾」並指到同一個共用暫存資料夾——這就是本機同步端點，不需要網路、帳號或伺服器。
// 同步走 App 真的流程：本機寫入 → almanac 領域排隊上傳；另一台回到前景（visibilitychange）→ 檢查遠端 meta → 拉、合併、寫回。
// 只跑 almanac 領域：記錄、設定、對話的自動同步關掉，避免和這張票無關的資料同步互相干擾。

interface Device {
  name: string
  context: BrowserContext
  page: Page
  mock: TauriMockController
  errors: Error[]
  /** console 的 warning／error：測試失敗時附在報告裡，看得到同步為什麼沒成功。 */
  logs: string[]
}

function sidebarAddButton(page: Page) {
  return page.getByRole('button', { name: '新增', exact: true }).first()
}

async function openDevice(browser: Browser, testInfo: TestInfo, name: string, syncRoot: string, vault: Record<string, string> = {}): Promise<Device> {
  const use = testInfo.project.use
  const context = await browser.newContext({ baseURL: use.baseURL, locale: use.locale, viewport: use.viewport })
  const page = await context.newPage()
  const errors: Error[] = []
  page.on('pageerror', error => errors.push(error))
  const logs: string[] = []
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') logs.push(`[${message.type()}] ${message.text()}`)
  })
  const mock = await setupTauriMock(page, { hostname: name, fsWatch: true })
  mock.setStoreKey('primaryBackupMethod', 'cloudFolder')
  mock.setStoreKey('cloudFolderSyncConfig', { path: syncRoot, provider: 'folder', displayName: 'E2E 同步資料夾' })
  mock.setStoreKey('autoRecordSyncEnabled', false)
  mock.setStoreKey('autoSettingsSyncEnabled', false)
  mock.setStoreKey('autoConversationSyncEnabled', false)
  for (const [relPath, content] of Object.entries(vault)) mock.writeVaultFile(relPath, content)
  await page.goto('/core/main')
  await waitForMainBoot(page)
  return { name, context, page, mock, errors, logs }
}

async function openSettings(page: Page, tabName: string): Promise<Locator> {
  await page.getByRole('button', { name: '設定', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '設定', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: tabName, exact: true }).click()
  return dialog
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '設定', exact: true })).toBeHidden()
}

/** 設定 → 同步設定 → 同步選項 → 打開「V3 跨裝置同步」，等第一次同步做完（畫面顯示主力裝置）。 */
async function enableV3Sync(device: Device, primaryName: string) {
  const dialog = await openSettings(device.page, '同步設定')
  await dialog.getByRole('tab', { name: '同步選項' }).click()
  const toggle = dialog.getByRole('switch', { name: 'V3 跨裝置同步' })
  await toggle.click()
  await expect(toggle).toBeChecked()
  const self = primaryName === device.name ? '（這台）' : ''
  await expect(dialog.getByText(`主力裝置：${primaryName}${self}`, { exact: true })).toBeVisible({ timeout: 30_000 })
  await closeSettings(device.page)
}

/**
 * 模擬 App 視窗被收起／回到前景（瀏覽器的 visibilitychange）。
 * 回到前景時 App 立刻檢查遠端 meta，另一台比較新就排一次 almanac 同步；收起時停掉定期檢查，這台就不會自己去拉。
 */
async function setWindowVisible(page: Page, visible: boolean) {
  await page.evaluate((isVisible: boolean) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (isVisible ? 'visible' : 'hidden') })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !isVisible })
    document.dispatchEvent(new Event('visibilitychange'))
  }, visible)
}

/** 反覆讓這台回到前景，直到 check 通過（另一台的上傳可能還沒寫完 meta.json，所以要能重試）。 */
async function syncUntil(device: Device, check: () => Promise<void>, timeout = 60_000) {
  await expect(async () => {
    await setWindowVisible(device.page, true)
    await check()
  }).toPass({ timeout, intervals: [1_000, 2_000, 3_000] })
}

/** 等某個同步檔（相對於 <資料夾>/.notegen/sync-v1/）出現指定內容：確認這台的上傳已經落地。 */
async function waitForRemote(relPath: string, text: string, timeout = 30_000) {
  const file = path.join(syncRoot, '.notegen', 'sync-v1', relPath)
  await expect.poll(() => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''), { timeout, message: `${relPath} 應包含「${text}」` }).toContain(text)
}

/** 資料源分頁：依序點各個狀態篩選，直到看到 text（另一台分析過的會在「已分析」，還沒分析的在「待處理」）。 */
async function expectSource(workbench: Locator, text: string | RegExp) {
  const filters = workbench.getByRole('group', { name: '依狀態篩選' })
  const list = workbench.getByRole('list', { name: '資料源清單' })
  for (const name of ['待處理', '已分析']) {
    await filters.getByRole('button', { name: new RegExp(`^${name}`) }).click()
    if (await list.getByText(text).first().isVisible().catch(() => false)) return
  }
  await expect(list.getByText(text).first()).toBeVisible({ timeout: 1_000 })
}

async function openWorkbenchTab(page: Page, tab: '審核' | '資料源'): Promise<Locator> {
  const workbench = page.getByRole('region', { name: '工作台' })
  if (!await workbench.isVisible().catch(() => false)) await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: /^工作台/ }).click()
  await expect(workbench).toBeVisible()
  await workbench.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
  return workbench
}

/** 開設定 → 常規設定，做完 run 再關掉（夥伴、Scott 的偏好、RSS 訂閱都在這一頁，每次打開會重新讀資料庫）。 */
async function withGeneralSettings(page: Page, run: (panel: Locator) => Promise<void>) {
  const dialog = await openSettings(page, '常規設定')
  try {
    await run(dialog.getByRole('tabpanel', { name: '常規設定' }))
  } finally {
    await closeSettings(page)
  }
}

async function saveScottPreferences(page: Page, text: string) {
  await withGeneralSettings(page, async panel => {
    const field = panel.getByRole('textbox', { name: 'Scott 的偏好' })
    await field.fill(text)
    await panel.getByRole('button', { name: '儲存 Scott 的偏好' }).click()
    await expect(panel.getByText('已儲存。')).toBeVisible()
  })
}

async function renameAgent(page: Page, from: string, to: string) {
  await withGeneralSettings(page, async panel => {
    await panel.getByRole('button', { name: `編輯 ${from}` }).click()
    await panel.getByRole('textbox', { name: '本名' }).fill(to)
    await panel.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(panel.getByRole('button', { name: `編輯 ${to}` })).toBeVisible()
  })
}

const FEED_URL = 'https://e2e.example/feed.xml'
const FEED_TITLE = 'E2E 測試 Feed'

function rssXml(items: Array<{ id: number; title: string }>) {
  const entries = items.map(item => `
    <item>
      <title>${item.title}</title>
      <link>https://e2e.example/posts/${item.id}</link>
      <guid>https://e2e.example/posts/${item.id}</guid>
      <pubDate>Thu, 26 Nov 2026 0${item.id}:00:00 GMT</pubDate>
      <description>${item.title}的內文，第 ${item.id} 篇。</description>
    </item>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${FEED_TITLE}</title><link>https://e2e.example/</link><description>E2E</description>${entries}
</channel></rss>`
}

/** 兩台都能抓同一個假 feed（不碰真實網路）；回傳改文章清單的函式，模擬網站之後又發了新文章。 */
function serveFeed(devicesToServe: Device[], initial: Array<{ id: number; title: string }>) {
  let items = initial
  for (const device of devicesToServe) {
    device.mock.setHttpHandler(request => (request.url === FEED_URL
      ? { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' }, body: rssXml(items) }
      : null))
  }
  return (next: Array<{ id: number; title: string }>) => { items = next }
}

let syncRoot = ''
let devices: Device[] = []

test.beforeEach(() => {
  syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-e2e-sync-'))
  devices = []
})

function listRemoteFiles(): string[] {
  const base = path.join(syncRoot, '.notegen', 'sync-v1')
  const files: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.push(path.relative(base, full))
    }
  }
  walk(base)
  return files.sort()
}

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const device of devices) {
      await testInfo.attach(`${device.name}-console.txt`, { body: device.logs.join('\n'), contentType: 'text/plain' })
      if (process.env.E2E_SYNC_DEBUG) console.log(`--- ${device.name} console ---\n${device.logs.join('\n')}`)
    }
    await testInfo.attach('sync-folder.txt', { body: listRemoteFiles().join('\n'), contentType: 'text/plain' })
    if (process.env.E2E_SYNC_DEBUG) {
      console.log(`--- sync folder ---\n${listRemoteFiles().join('\n')}`)
      const meta = path.join(syncRoot, '.notegen', 'sync-v1', '.data', 'meta.json')
      if (fs.existsSync(meta)) console.log(`--- meta.json ---\n${fs.readFileSync(meta, 'utf8')}`)
      for (const device of devices) {
        const storeFile = path.join(device.mock.appDataDir, 'store.json')
        const store = fs.existsSync(storeFile) ? JSON.parse(fs.readFileSync(storeFile, 'utf8')) as Record<string, unknown> : {}
        const picked = Object.fromEntries(Object.entries(store).filter(([key]) => /sync|almanac|deviceId/i.test(key)))
        console.log(`--- ${device.name} store ---\n${JSON.stringify(picked, null, 2)}`)
        try {
          console.log(`--- ${device.name} sources ---\n${JSON.stringify(device.mock.querySql('select id, status, substr(content, 1, 40) as content from sources'), null, 2)}`)
        } catch (error) {
          console.log(`--- ${device.name} sources --- ${String(error)}`)
        }
      }
    }
  }
  for (const device of devices) {
    await device.context.close().catch(() => undefined)
    device.mock.dispose()
  }
  fs.rmSync(syncRoot, { recursive: true, force: true })
  for (const device of devices) {
    // 翻譯字串缺漏（例如同步狀態列的 almanac 領域名稱）也算失敗：畫面上會出現 key 而不是文字。
    expect(device.logs.filter(line => line.includes('MISSING_MESSAGE')), `${device.name} missing translations`).toHaveLength(0)
    expect(device.errors, `${device.name} uncaught page errors: ${device.errors.map(error => error.message).join('; ')}`).toHaveLength(0)
  }
})

/** 開兩台並打開 V3 同步（A 先開，A 是主力裝置）。vault：兩台開機前筆記庫裡就有、內容一樣的檔案。 */
async function pairDevices(browser: Browser, testInfo: TestInfo, vault: Record<string, string> = {}): Promise<[Device, Device]> {
  const a = await openDevice(browser, testInfo, 'Mac-A', syncRoot, vault)
  devices.push(a)
  const b = await openDevice(browser, testInfo, 'Mac-B', syncRoot, vault)
  devices.push(b)
  await enableV3Sync(a, 'Mac-A')
  await enableV3Sync(b, 'Mac-A')
  return [a, b]
}

test('資料源與 RSS：A 新增資料源、訂閱 RSS → B 同步後看得到文章，已讀清單一致（立即更新不重複收）', async ({ browser }, testInfo) => {
  const [a, b] = await pairDevices(browser, testInfo)
  const setFeedItems = serveFeed([a, b], [{ id: 1, title: 'RSS 文章一：番茄鐘' }, { id: 2, title: 'RSS 文章二：時間區塊' }])

  // A：手動新增一則文字資料源
  await sidebarAddButton(a.page).click()
  await a.page.getByRole('menuitem', { name: /新增資料源/ }).click()
  const dialog = a.page.getByRole('dialog', { name: '新增資料源' })
  await dialog.getByRole('textbox').fill('E2E 同步資料源：A 台寫的觀察\n兩台裝置要看到同一則。')
  await dialog.getByRole('button', { name: /儲存文字/ }).click()

  // A：訂閱 RSS（第一次收進 2 篇）
  await withGeneralSettings(a.page, async panel => {
    await panel.getByRole('textbox', { name: 'Feed 網址' }).fill(FEED_URL)
    await panel.getByRole('button', { name: '訂閱', exact: true }).click()
    await expect(a.page.getByText(`已訂閱「${FEED_TITLE}」，收進 2 篇`)).toBeVisible()
  })

  // B：同步後，工作台資料源分頁看得到 A 新增的資料源與兩篇 RSS 文章
  const workbenchB = await openWorkbenchTab(b.page, '資料源')
  await syncUntil(b, async () => {
    await expectSource(workbenchB, /E2E 同步資料源：A 台寫的觀察/)
    await expectSource(workbenchB, /RSS 文章一：番茄鐘/)
    await expectSource(workbenchB, /RSS 文章二：時間區塊/)
  })

  // B：RSS 訂閱也同步過來；已讀清單（seen）跟著到，所以立即更新不會把同兩篇再收一次
  await withGeneralSettings(b.page, async panel => {
    await expect(panel.getByRole('textbox', { name: `「${FEED_TITLE}」的名稱` })).toHaveValue(FEED_TITLE)
    await panel.getByRole('button', { name: '立即更新' }).click()
    await expect(b.page.getByText('已更新，新增 0 篇')).toBeVisible()

    // 網站發了第三篇：B 只收新的那一篇
    setFeedItems([{ id: 1, title: 'RSS 文章一：番茄鐘' }, { id: 2, title: 'RSS 文章二：時間區塊' }, { id: 3, title: 'RSS 文章三：每週回顧' }])
    await panel.getByRole('button', { name: '立即更新' }).click()
    await expect(b.page.getByText('已更新，新增 1 篇')).toBeVisible()
  })

  // A：B 收的第三篇同步回來；A 的立即更新也不重收
  const workbenchA = await openWorkbenchTab(a.page, '資料源')
  await syncUntil(a, async () => {
    await expectSource(workbenchA, /RSS 文章三：每週回顧/)
  })
  await withGeneralSettings(a.page, async panel => {
    await panel.getByRole('button', { name: '立即更新' }).click()
    await expect(a.page.getByText('已更新，新增 0 篇')).toBeVisible()
  })
})

test('夥伴與偏好：A 改秘書本名、寫 Scott 的偏好 → B 同步後在設定頁看得到', async ({ browser }, testInfo) => {
  const [a, b] = await pairDevices(browser, testInfo)

  await renameAgent(a.page, 'Leo', '小林')
  await saveScottPreferences(a.page, '回覆一律用繁體中文。\n摘要不超過三行。')

  // B 開機時自己也建了一份預設名單（Leo 等），A 改過的名字要留下，不被 B 的預設值蓋掉（設計 2.6）
  await syncUntil(b, async () => {
    await withGeneralSettings(b.page, async panel => {
      await expect(panel.getByRole('button', { name: '編輯 小林' })).toBeVisible({ timeout: 2_000 })
      await expect(panel.getByRole('button', { name: '編輯 Leo' })).toHaveCount(0)
      await expect(panel.getByRole('textbox', { name: 'Scott 的偏好' })).toHaveValue('回覆一律用繁體中文。\n摘要不超過三行。', { timeout: 2_000 })
    })
  })
})

test('同時修改：B 時鐘慢 5 分鐘、兩台改同一段 Scott 的偏好 → 出確認卡、兩版都在；同時改秘書本名 → 依時間較晚的贏', async ({ browser }, testInfo) => {
  const [a, b] = await pairDevices(browser, testInfo)
  const original = '回覆語言：繁體中文\n摘要長度：三行\n稱呼：Scott'
  await saveScottPreferences(a.page, original)
  await syncUntil(b, async () => {
    await withGeneralSettings(b.page, async panel => {
      await expect(panel.getByRole('textbox', { name: 'Scott 的偏好' })).toHaveValue(original, { timeout: 2_000 })
    })
  })

  // B 收起視窗（不再自己去拉），時鐘慢 5 分鐘；兩台在看不到對方的情況下各改一次
  await setWindowVisible(b.page, false)
  await b.mock.setClockOffsetMs(b.page, -5 * 60_000)

  await saveScottPreferences(a.page, '回覆語言：繁體中文\n摘要長度：A 台改成五行\n稱呼：Scott')
  await renameAgent(a.page, 'Leo', 'A 台取的秘書名')
  await waitForRemote('.data/almanac/crew.json', 'A 台改成五行')
  await waitForRemote('.data/almanac/crew.json', 'A 台取的秘書名')

  // B 在真實時間上比 A 晚改，但 B 的時鐘慢 5 分鐘，所以 B 的修改時間比較早
  await saveScottPreferences(b.page, '回覆語言：繁體中文\n摘要長度：B 台改成一行\n稱呼：Scott')
  await renameAgent(b.page, 'Leo', 'B 台取的秘書名')

  // B 上傳時發現兩台改到同一行：工作台出確認卡，這台的版本先留著，另一台的版本也在卡上（設計 1.7 第 1 種、第 8 節 3A）
  const workbenchB = await openWorkbenchTab(b.page, '審核')
  const card = workbenchB.getByRole('region', { name: '同步確認：Scott 的偏好' })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByRole('group', { name: '這台的版本' })).toContainText('摘要長度：B 台改成一行')
  await expect(card.getByRole('group', { name: '另一台的版本' })).toContainText('摘要長度：A 台改成五行')

  await withGeneralSettings(b.page, async panel => {
    // 偏好：卡片處理前保留這台的版本
    await expect(panel.getByRole('textbox', { name: 'Scott 的偏好' })).toHaveValue('回覆語言：繁體中文\n摘要長度：B 台改成一行\n稱呼：Scott')
    // 秘書本名是一般欄位：兩邊都改時取修改時間較晚的（A；B 的時鐘慢了 5 分鐘），不出卡
    await expect(panel.getByRole('button', { name: '編輯 A 台取的秘書名' })).toBeVisible()
    await expect(panel.getByRole('button', { name: '編輯 B 台取的秘書名' })).toHaveCount(0)
  })

  // Scott 在 B 的卡上選「用另一台的」→ 兩台最後都是 A 的版本
  await card.getByRole('button', { name: '用另一台的' }).click()
  await expect(card).toBeHidden()
  await withGeneralSettings(b.page, async panel => {
    await expect(panel.getByRole('textbox', { name: 'Scott 的偏好' })).toHaveValue('回覆語言：繁體中文\n摘要長度：A 台改成五行\n稱呼：Scott')
  })
  await syncUntil(a, async () => {
    await withGeneralSettings(a.page, async panel => {
      await expect(panel.getByRole('textbox', { name: 'Scott 的偏好' })).toHaveValue('回覆語言：繁體中文\n摘要長度：A 台改成五行\n稱呼：Scott', { timeout: 2_000 })
      await expect(panel.getByRole('button', { name: '編輯 A 台取的秘書名' })).toBeVisible()
    })
  })
})

const MOC_PATH = '20 領域/時間管理.md'
const NOTE_KEEP = '知識/說不比提高效率更省時間.md'
const NOTE_NEW = '知識/每週回顧是最小動作.md'

function knowledgeNote(title: string, id: string) {
  return `---\nid: ${id}\ntype: knowledge\ntitle: ${title}\n---\n# ${title}\n\n${title}的內文。\n`
}

function mocFile(entries: string[]) {
  return [
    '---',
    'id: M-20261112-060012-VPB3',
    'kind: domain',
    'title: 時間管理',
    '---',
    '# 時間管理',
    '',
    '## ① 這個領域在回答什麼',
    '有限的時間和注意力，怎麼分配給真正重要的事？',
    '',
    '## ③ 章節',
    '',
    '### 決定做什麼',
    '<!-- C-20261112-060020-N9NR -->',
    ...entries,
    '',
    '## ④ 重點結論',
    '- 先決定不做什麼，再決定什麼時候做。',
    '',
  ].join('\n')
}

async function activityText(page: Page): Promise<string[]> {
  let items: string[] = []
  await withGeneralSettings(page, async panel => {
    const list = panel.getByRole('list', { name: '活動紀錄' })
    await expect(list).toBeVisible()
    items = await list.getByRole('listitem').allInnerTexts()
  })
  return items
}

test('MOC：A 在 Obsidian 改 MOC 收錄 → B 收到檔案後 MOC 頁一致，不出整批檢查、不重複記活動紀錄', async ({ browser }, testInfo) => {
  // 兩台的筆記庫一開始一樣（筆記庫本身放在雲端資料夾裡，由 iCloud 這類 App 外同步搬檔）；開機時各自建好 MOC 的上次已知狀態
  const [a, b] = await pairDevices(browser, testInfo, {
    [NOTE_KEEP]: knowledgeNote('說不比提高效率更省時間', 'N-20261112-060100-AAAA'),
    [MOC_PATH]: mocFile(['- [[說不比提高效率更省時間]] ── 先刪，再排']),
  })

  // A：在 Obsidian 新增一則筆記並收進 MOC
  a.mock.writeVaultFileExternally(NOTE_NEW, knowledgeNote('每週回顧是最小動作', 'N-20261112-060200-BBBB'))
  a.mock.writeVaultFileExternally(MOC_PATH, mocFile(['- [[說不比提高效率更省時間]] ── 先刪，再排', '- [[每週回顧是最小動作]] ── 每週五半小時']))
  await expect(a.page.getByText(/已套用在 Obsidian 對 MOC 的 \d+ 處修改/)).toBeVisible({ timeout: 20_000 })
  const entry = /每週回顧是最小動作 › 時間管理/
  const activityA = await activityText(a.page)
  expect(activityA.filter(item => entry.test(item))).toHaveLength(1)
  await waitForRemote('.almanac/v3/moc-baselines.json', '每週回顧是最小動作')

  // B：同步收到 A 的上次已知狀態、ops 與活動紀錄（活動紀錄標「來自 Mac-A」）
  await syncUntil(b, async () => {
    const items = await activityText(b.page)
    expect(items.filter(item => entry.test(item))).toHaveLength(1)
    expect(items.find(item => entry.test(item))).toContain('來自 Mac-A')
  })

  // iCloud 把 A 改過的檔案搬到 B（照 A 筆記庫裡現在的內容）
  b.mock.writeVaultFileExternally(NOTE_NEW, a.mock.readVaultFile(NOTE_NEW))
  b.mock.writeVaultFileExternally(MOC_PATH, a.mock.readVaultFile(MOC_PATH))

  // B 的 MOC 頁跟 A 一致：新筆記收在「決定做什麼」
  await b.page.getByRole('button', { name: '整理', exact: true }).click()
  const knowledge = b.page.getByRole('region', { name: '整理' })
  await knowledge.getByRole('tab', { name: '領域', exact: true }).click()
  await knowledge.getByRole('button', { name: /^時間管理/ }).click()
  await expect(knowledge.getByText('每週回顧是最小動作')).toBeVisible({ timeout: 20_000 })
  await expect(knowledge.getByText('說不比提高效率更省時間')).toBeVisible()

  // 檔案內容等於同步來的上次已知狀態 → B 當成同步來的，不當成 Scott 又手動改了一次：
  // 沒有「已套用」提示、工作台沒有整批檢查卡、活動紀錄仍只有 A 那一筆
  await expect(b.page.getByText(/已套用在 Obsidian 對 MOC/)).toHaveCount(0)
  const reviewB = await openWorkbenchTab(b.page, '審核')
  await expect(reviewB.getByText(/整批檢查/)).toHaveCount(0)
  const activityB = await activityText(b.page)
  expect(activityB.filter(item => entry.test(item))).toHaveLength(1)

  // A 再同步一次：也沒有多出 B 記的重複紀錄
  await setWindowVisible(a.page, true)
  await a.page.waitForTimeout(3_000)
  const activityAfter = await activityText(a.page)
  expect(activityAfter.filter(item => entry.test(item))).toHaveLength(1)
})
