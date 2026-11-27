// Fork（almanac ALMNC-87／95.5）：右側 AI 對話交代秘書新增任務並指定專案 → 任務寫進今天的日誌、掛上專案標籤 →
// 整理的「標籤」分頁點專案標籤看得到那篇日誌、今天的待辦看得到任務；說了不存在的專案就不掛。
// AI 回應用 mockIPC 固定內容：第一次串流請求回 schedule_add_task 工具呼叫，拿到工具結果後回一句確認。
import { expect, test, type Page } from '@playwright/test'
import { setupTauriMock, waitForMainBoot, type TauriMockController } from './tauri-mock'

let mock: TauriMockController
let pageErrors: Error[] = []

const PROJECT = '電子紙'
const TASK_TITLE = '寄樣品給廠商'
const QUOTE = '新增任務：寄樣品給廠商'

interface ChatBody {
  tools?: Array<{ function?: { name?: string } }>
  messages?: Array<{ role?: string, content?: unknown }>
}

function completion(message: Record<string, unknown>, finishReason = 'stop') {
  return { id: 'e2e', object: 'chat.completion', created: 0, model: 'e2e-chat', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }
}

/** 秘書固定的回應：先呼叫 schedule_add_task（帶 project），拿到工具結果後回一句確認。回傳收到的工具結果訊息。 */
function scriptSecretary(project: string) {
  const toolResults: string[] = []
  mock.setAiHandler(req => {
    if (req.path === '/models') return { object: 'list', data: [{ id: 'e2e-chat', object: 'model', created: 0, owned_by: 'e2e' }] }
    const body = (req.body ?? {}) as ChatBody
    const offersTool = body.tools?.some(tool => tool.function?.name === 'schedule_add_task')
    if (!offersTool) return completion({ content: 'OK' })
    const toolMessages = (body.messages ?? []).filter(message => message.role === 'tool')
    if (toolMessages.length === 0) {
      return completion({
        content: null,
        tool_calls: [{
          id: 'call-e2e-task',
          type: 'function',
          function: { name: 'schedule_add_task', arguments: JSON.stringify({ title: TASK_TITLE, project, quote: QUOTE }) },
        }],
      }, 'tool_calls')
    }
    toolResults.push(...toolMessages.map(message => {
      const raw = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      try {
        return String((JSON.parse(raw) as { message?: unknown }).message ?? raw)
      } catch {
        return raw
      }
    }))
    return completion({ content: '好，加好了。' })
  })
  return toolResults
}

async function askSecretary(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: '交代一件事，例如：明天 10:00 跟 A 開會' })
  await expect(input).toBeEnabled()
  await input.fill(text)
  await input.press('Enter')
  // 秘書照 Scott 親口交代直接寫入：對話裡出現一行確認，附「復原」
  await expect(page.getByText(`已新增：${TASK_TITLE}`, { exact: false })).toBeVisible({ timeout: 20_000 })
}

function findTaskFile(): string | undefined {
  return mock.listVaultFiles().find(name => name.endsWith('.md') && mock.readVaultFile(name).includes(TASK_TITLE))
}

test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => {
    pageErrors.push(error)
  })
  // 秘書寫入今天的日誌後，標籤分頁與今天的待辦靠筆記庫索引更新：打開檔案監看模擬
  mock = await setupTauriMock(page, { fsWatch: true })
  // 現有專案來自對話頁的專案分組（store.json 的 threadProjects）
  mock.setStoreKey('threadProjects', { 'e2e-project-thread': PROJECT })
})

test.afterEach(() => {
  mock?.dispose()
  expect(pageErrors, `Uncaught page errors: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0)
})

test('秘書新增任務時指定現有專案：任務掛上專案標籤，標籤分頁與今天的待辦都看得到', async ({ page }) => {
  const toolResults = scriptSecretary(PROJECT)
  await page.goto('/core/main')
  await waitForMainBoot(page)

  await askSecretary(page, `@秘書 ${QUOTE}，算在${PROJECT}專案`)

  // 工具結果：直接寫入並掛上專案
  await expect.poll(() => toolResults.join('\n')).toContain(`(project: ${PROJECT})`)
  // 今天的日誌多一行任務，帶專案標籤
  await expect.poll(() => findTaskFile()).toBeTruthy()
  const taskFile = findTaskFile()!
  expect(mock.readVaultFile(taskFile)).toMatch(new RegExp(`- \\[ \\] ${TASK_TITLE} 📅 \\d{4}-\\d{2}-\\d{2} #${PROJECT}`))

  // 整理 → 標籤：專案標籤底下看得到這篇日誌
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '整理', exact: true }).click()
  const knowledge = page.getByRole('region', { name: '整理' })
  await knowledge.getByRole('tab', { name: '標籤', exact: true }).click()
  const tagTree = knowledge.getByRole('tree')
  await tagTree.getByRole('treeitem', { name: new RegExp(PROJECT) }).getByRole('button', { name: new RegExp(PROJECT) }).click()
  const taggedNotes = knowledge.getByRole('region', { name: PROJECT, exact: true })
  const noteName = taskFile.slice(taskFile.lastIndexOf('/') + 1).replace(/\.md$/, '')
  await expect(taggedNotes.getByRole('button', { name: new RegExp(noteName) })).toBeVisible()

  // 今天的待辦看得到這個任務
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '今天', exact: true }).click()
  await expect(page.getByRole('region', { name: '今天' }).getByRole('checkbox', { name: new RegExp(TASK_TITLE) })).toBeVisible()
})

test('秘書新增任務時說了不存在的專案：照樣寫入任務，但不掛專案標籤', async ({ page }) => {
  const toolResults = scriptSecretary('不存在的專案')
  await page.goto('/core/main')
  await waitForMainBoot(page)

  await askSecretary(page, `@秘書 ${QUOTE}，算在不存在的專案`)

  await expect.poll(() => toolResults.join('\n')).toContain('No existing project is named "不存在的專案", so no project was attached')
  expect(toolResults.join('\n')).not.toContain('(project:')
  await expect.poll(() => findTaskFile()).toBeTruthy()
  const line = mock.readVaultFile(findTaskFile()!).split('\n').find(entry => entry.includes(TASK_TITLE))
  expect(line).toMatch(new RegExp(`^- \\[ \\] ${TASK_TITLE} 📅 \\d{4}-\\d{2}-\\d{2}$`))
  expect(line).not.toContain('#')
})
