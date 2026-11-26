## Agent skills

### Issue tracker

Issue 記在 GitHub（fork：ShiGaChenTW/note-gen，`gh` 一律加 `--repo ShiGaChenTW/note-gen`）。見 `docs/agents/issue-tracker.md`。

### Triage labels

使用預設五個標籤（needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix）。見 `docs/agents/triage-labels.md`。

### Domain docs

single-context（根目錄 `GLOSSARY.md` + `docs/adr/`）。見 `docs/agents/domain.md`。

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.55.3 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->

## 開發規範

### UI 元件測試與 TDD 規則（ALMNC-94）

所有 V3 UI 互動與入口異動預設採 **TDD（Red → Green → Refactor）** 流程：先在對應的 `.test.tsx` 寫下會失敗的行為測試，再修改實作直到測試通過。

1. **必須先寫 UI 測試的驗收條件（AC）**
   - 新增、刪除、搬移或改名任何使用者入口（主導覽、整理分頁、`+` 選單、命令面板指令）。
   - 控制元件的可見性／啟用條件、狀態切換（選取、展開、開關）、確認提示與回呼行為。
   - 若異動影響 V3 主要入口，必須同步更新 `src/app/core/main/sidebar-v3/v3-entry-inventory.ts`（`V3_ENTRY_INVENTORY`），並通過 `src/app/core/main/sidebar-v3/v3-entry-inventory.test.tsx` 的雙向一致檢查。

2. **例外情況（免元件 TDD，改以對應說明／手測驗證）**
   - 純視覺與排版調整（間距、字級、色彩 token、過場動畫）或主觀 UX 手感微調。
   - 高度依賴真實 Tauri 原生視窗／Native API、真實檔案系統或作業系統級 IME 組合輸入（由手測 UAT 或專門整合驗證覆蓋）。

3. **測試寫法限制**
   - 使用 `@/test/render-v3` 匯出的 `renderV3()` 與 `screen`，預設具備 V3 模式、`zh-TW` 語系、主題與 `userEvent` 實例 `{ user }`。
   - 僅能透過 ARIA role 與可見文字／accessible name 查詢（如 `getByRole`、`findByRole`、`getByText`）；**禁用 `querySelector`、CSS class 選擇器與 `data-testid`**。
   - **禁止 mock Radix UI（`Popover`、`DropdownMenu`）與 `CommandDialog`／`cmdk`**；僅在測試邊界 mock 無關的葉子元件與 Tauri I/O／資料庫模組。

4. **送審證據要求**
   - PR 說明或卡片送審備註中，必須列出**測試檔案路徑**與**測試名稱（`describe` / `it`）**以及 `npx vitest run <test-file>` 執行結果；若符合例外條款，需明確標註例外原因與替代驗證方式。

5. **參考示範與最小 TDD 寫法**
   - 基本互動與 Radix Popover／DropdownMenu 示範：`src/test/render-v3.test.tsx`
   - V3 元件標題與按鈕狀態互動示範：`src/app/core/main/page-header-v3.test.tsx`
   - ARIA role 雙向入口清單示範：`src/app/core/main/sidebar-v3/v3-entry-inventory.test.tsx`

   ```tsx
   import { describe, expect, it, vi } from 'vitest'
   import { renderV3, screen } from '@/test/render-v3'

   describe('ExampleMenu', () => {
     it('點擊＋選單可觸發對應動作（Red → Green）', async () => {
       const onSelect = vi.fn()
       const { user } = renderV3(<ExampleMenu onSelect={onSelect} />)

       // 先確認紅燈：實作前找不到選單項目或未觸發回呼
       await user.click(screen.getByRole('button', { name: '新增' }))
       await user.click(await screen.findByRole('menuitem', { name: '新增畫布' }))
       expect(onSelect).toHaveBeenCalledOnce()
     })
   })
   ```

### E2E 測試（Playwright + Tauri mockIPC）

- 執行全部 E2E 測試（連接本機 Next dev，不需啟動 Rust / Tauri Desktop）：
  ```bash
  pnpm test:e2e
  ```
- 首次在本機安裝 Chromium 執行檔：
  ```bash
  pnpm exec playwright install chromium
  ```
- 測試規格位置：`tests/e2e/*.spec.ts`，由 `playwright.config.ts` 自動啟動 `next dev`（`http://localhost:3456`），不會與 `vitest run`（僅掃描 `*.test.ts(x)`）衝突。
- `tests/e2e/tauri-mock.ts` 在 Node 端使用真實 `node:sqlite`（記憶體資料庫）與暫存目錄隔離每個測試的檔案系統、Store、Tauri Event 匯流排、AI 請求模擬、虛擬時鐘與本機 MCP 橋接。
- 寫 E2E 測試時同樣遵守 ARIA role 與可見文字／無障礙名稱定位原則（不寫 CSS selector、`querySelector` 或 `data-testid`），且每支測試必須確保零未捕獲 `pageerror`。


