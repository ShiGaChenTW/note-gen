// Fork（almanac ALMNC-90）：紀錄筆記「送給指揮官萃取」→ 工作台出現新增知識筆記提案 → 重複送出被擋下 → 接受後知識筆記連回紀錄筆記。
// AI 回應用 mockIPC 固定內容：萃取提示回傳一個知識片段（外加一個任務，應被濾掉），撰寫提示回傳固定草稿。
import { expect, test, type Page } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

const RECORD_PATH = '30 日誌/2026-11-10 週會.md'
const RECORD_NOTE = '---\ntype: log\ntitle: 11/10 週會\n---\n# 11/10 週會\n\n決定每天留 30 分鐘緩衝。大家都發現切換工作的代價比想像中高。\n'
const KNOWLEDGE_PATH = '知識/番茄鐘.md'
const KNOWLEDGE_NOTE = '---\ntype: knowledge\ntitle: 番茄鐘一次 25 分鐘\n---\n# 番茄鐘一次 25 分鐘\n'
const KNOWLEDGE_TITLE = '切換工作的代價比想像中高'

function completion(content: string) {
  return { id: 'e2e', object: 'chat.completion', created: 0, model: 'e2e-chat', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }
}

function promptOf(body: unknown): string {
  const messages = (body as { messages?: Array<{ content?: unknown }> } | undefined)?.messages ?? []
  return messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')
}

async function openNote(page: Page, name: RegExp) {
  const tree = page.getByRole('tree', { name: '工作區檔案' })
  const expand = page.getByRole('button', { name: '展開我的筆記', exact: true })
  await expect(tree.or(expand)).toBeVisible()
  if (await expand.isVisible()) await expand.click()
  const folder = (label: string) => tree.getByRole('treeitem', { name: label, exact: true })
  for (const label of ['30 日誌', '知識']) {
    const item = folder(label)
    if (await item.isVisible() && (await item.getAttribute('aria-expanded')) === 'false') await item.click()
  }
  await tree.getByRole('treeitem', { name }).click()
}

test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => {
    pageErrors.push(error)
  })
  mock = await setupTauriMock(page)
})

test.afterEach(() => {
  mock?.dispose()
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0)
})

test('紀錄筆記送給指揮官萃取：一張新增知識筆記提案、重複送出不重複、接受後連回紀錄筆記', async ({ page }) => {
  let extractCalls = 0
  mock.setAiHandler(req => {
    if (req.path === '/models') return { object: 'list', data: [{ id: 'e2e-chat', object: 'model', created: 0, owned_by: 'e2e' }] }
    const prompt = promptOf(req.body)
    if (prompt.includes('{"drafts"')) {
      return completion(JSON.stringify({ drafts: [{ index: 0, title: KNOWLEDGE_TITLE, body: '每次切換都要重新進入狀態，零碎的打斷累積起來很可觀。' }] }))
    }
    if (prompt.includes('萃取知識筆記')) {
      extractCalls++
      return completion(JSON.stringify({ fragments: [
        { kind: 'note', noteType: 'knowledge', title: KNOWLEDGE_TITLE, body: '切換工作的代價比想像中高。', reason: '一年後仍成立的主張', confidence: 'high' },
        { kind: 'task', title: '每天留 30 分鐘緩衝' },
      ] }))
    }
    return completion('OK')
  })
  mock.writeVaultFile(RECORD_PATH, RECORD_NOTE)
  mock.writeVaultFile(KNOWLEDGE_PATH, KNOWLEDGE_NOTE)

  await page.goto('/core/main')
  await waitForMainBoot(page)

  // 知識筆記沒有這顆按鈕
  const toolbar = page.getByRole('toolbar', { name: '筆記工具列' })
  await openNote(page, /番茄鐘/)
  await expect(toolbar.getByRole('button', { name: '送給指揮官', exact: true })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: '送給指揮官萃取' })).toHaveCount(0)

  // 紀錄筆記：送出萃取
  await openNote(page, /週會/)
  const extract = toolbar.getByRole('button', { name: '送給指揮官萃取' })
  await extract.click()
  await expect(page.getByText('已送給指揮官萃取，知識筆記提案會出現在工作台')).toBeVisible()

  // 工作台：一張新增知識筆記提案（任務被濾掉）
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: /^工作台/ }).click()
  const workbench = page.getByRole('region', { name: '工作台' })
  const reviewTab = workbench.getByRole('tab', { name: /審核\s*1/ })
  await expect(reviewTab).toBeVisible({ timeout: 20_000 })
  expect(extractCalls).toBe(1)

  // 再送一次：已有未處理提案，提示、不重送
  await openNote(page, /週會/)
  await toolbar.getByRole('button', { name: '送給指揮官萃取' }).click()
  await expect(page.getByText('這篇還有萃取提案沒處理，先到工作台處理完再送')).toBeVisible()
  expect(extractCalls).toBe(1)

  // 接受提案：知識筆記寫入，來源連回紀錄筆記
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: /^工作台/ }).click()
  await workbench.getByRole('tab', { name: /審核\s*1/ }).click()
  const card = workbench.getByRole('button', { name: new RegExp(KNOWLEDGE_TITLE) }).first()
  await card.click()
  await workbench.getByRole('button', { name: /接受/ }).first().click()
  await expect(page.getByText(new RegExp(`已接受「${KNOWLEDGE_TITLE}」`))).toBeVisible()
  await expect.poll(() => mock.listVaultFiles().find(name => name.endsWith('.md') && name.includes(KNOWLEDGE_TITLE))).toBeTruthy()
  const written = mock.readVaultFile(mock.listVaultFiles().find(name => name.endsWith('.md') && name.includes(KNOWLEDGE_TITLE))!)
  expect(written).toContain('type: knowledge')
  expect(written).toContain('related: [ "[[2026-11-10 週會]]" ]')
  expect(written).toContain(`sources: [ src_extract:${RECORD_PATH} ]`)
  // 紀錄筆記原文留在原處（開啟時系統只補身分編號）
  expect(mock.readVaultFile(RECORD_PATH)).toContain('type: log')
  expect(mock.readVaultFile(RECORD_PATH)).toContain('決定每天留 30 分鐘緩衝。大家都發現切換工作的代價比想像中高。')

  // 提案處理完、內容沒變：一樣不重送
  await openNote(page, /週會/)
  await toolbar.getByRole('button', { name: '送給指揮官萃取' }).click()
  await expect(page.getByText('這篇已經送過萃取了，內容沒有變')).toBeVisible()
  expect(extractCalls).toBe(1)
})
