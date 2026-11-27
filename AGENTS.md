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

- 執行全部 E2E 測試（不需啟動 Rust / Tauri Desktop）：
  ```bash
  pnpm test:e2e
  ```
- 預設跑**打包好的靜態版**（`out/`），不跑 dev server：
  1. `tests/e2e/build-if-stale.mjs`：`out/` 比原始碼（`src/`、`messages/`、`public/`、`config/`、`next.config.ts`、`package.json`、`pnpm-lock.yaml` 等；測試檔不算）舊才跑 `pnpm build`，約 1～2 分鐘；沒改原始碼就直接跳過。
  2. `tests/e2e/static-server.mjs`：不需額外依賴的小 Node 伺服器，在 `http://localhost:3456` 提供 `out/`（`/core/main` → `core/main.html`；找不到的路徑回 `404.html`）。
  原因：Turbopack dev server 的 HMR 與即時編譯會讓整套連跑時隨機失敗（連不到 server、`Failed to load chunk …hmr-client…`、冷編譯時元素找不到），靜態版沒有這些問題。
- 環境變數：
  - `E2E_SKIP_BUILD=1`：不檢查也不建置，直接用現有的 `out/`。只在你確定 `out/` 是最新的（例如剛跑完 `pnpm build`）時用。
  - `E2E_DEV=1`：改用原本的 `next dev --turbopack`，並先跑 `tests/e2e/global-setup.ts` 暖機。給本機邊改邊跑單一測試用（不用等建置）；dev 版本來就會偶發失敗，**驗收、交 PR 前一律用預設的靜態版跑完整套件**。
  - `E2E_PORT=<埠>`：換埠（預設 3456）。靜態版不沿用已在該埠的伺服器，3456 被 `pnpm dev` 或其他 worktree 的 E2E 佔用時會直接報錯，此時換一個埠，例如 `E2E_PORT=3466 pnpm test:e2e`。
- 首次在本機安裝 Chromium 執行檔：
  ```bash
  pnpm exec playwright install chromium
  ```
- 測試規格位置：`tests/e2e/*.spec.ts`，伺服器由 `playwright.config.ts` 自動啟動，不會與 `vitest run`（僅掃描 `*.test.ts(x)`）衝突。
- 測試不能依賴 dev server 的慢速掩蓋時序：靜態版載入快，啟動時的非同步動作（例如自動打開今天的日記會收起覆蓋層）可能在測試第一步之後才發生。每支測試 `page.goto('/core/main')` 之後先 `await waitForMainBoot(page)`（`tests/e2e/tauri-mock.ts`），等啟動落定再操作。
- 測試規格分兩個 Playwright project：`e2e`（`tests/e2e/*.spec.ts`，功能流程）與 `visual`（`tests/e2e/visual/*.visual.ts`，截圖比對）。`pnpm test:e2e` 只跑 `e2e`，不會因像素差異失敗；截圖比對另用 `pnpm test:visual`，見下一節。
- `tests/e2e/tauri-mock.ts` 在 Node 端使用真實 `node:sqlite`（記憶體資料庫）與暫存目錄隔離每個測試的檔案系統、Store、Tauri Event 匯流排、AI 請求模擬、虛擬時鐘與本機 MCP 橋接。
- 寫 E2E 測試時同樣遵守 ARIA role 與可見文字／無障礙名稱定位原則（不寫 CSS selector、`querySelector` 或 `data-testid`），且每支測試必須確保零未捕獲 `pageerror`。



### 截圖比對（Playwright visual regression，ALMNC-94.5）

視覺規範（顏色、間距、深色模式）jsdom 測不到，改用 Playwright 對主要畫面截圖、和 repo 裡的基準圖比對。

- 執行：
  ```bash
  pnpm test:visual
  ```
  共用 `pnpm test:e2e` 的伺服器設定（靜態版 `out/`、`E2E_SKIP_BUILD`、`E2E_PORT` 都一樣用）。
- 範圍：`tests/e2e/visual/main-flows.visual.ts`，8 個畫面（今天、工作台、整理的畫布與標籤分頁、對話頁、命令面板、設定視窗、最近刪除）× 淺色／深色，共 16 張。深淺色用 Playwright 的 `colorScheme`，測試會確認 `<html>` 真的套上（或拿掉）`dark` class。
- 基準檔：`tests/e2e/visual/__screenshots__/<平台>/<畫面>-<light|dark>.png`，**以 macOS（darwin）產生並 commit**。路徑帶平台，Linux／Windows 上跑不會拿 macOS 的圖誤判（那些平台沒有基準，會直接報缺基準）。字型渲染跟機器有關，基準只在 macOS 上產生、更新。
- 穩定化做法（新增畫面時照做）：視窗固定 1280×860、`deviceScaleFactor: 1`、時區 `Asia/Taipei`；`page.clock.setFixedTime` 把時間固定在 2026-03-12 10:30；config 預設 `animations: 'disabled'`、`caret: 'hide'`；截圖前等主題與字型（`document.fonts`）落定、把滑鼠移開避免 hover 樣式；toast 與相對時間（「剛剛」）用 `mask` 遮住；非同步出現的內容（例如工作台「1 件」徽章）先等它出現再截。
- 什麼時候要更新基準：
  - **刻意改了畫面**（顏色 token、間距、字級、版面、文案、圖示、這 8 個畫面上的元件）→ 更新。
  - 新增或刪除截圖畫面 → 產生新基準、刪掉不用的舊基準檔。
  - **沒有打算改畫面卻失敗** → 不要更新，先看 `test-results/` 裡的 `*-diff.png`、`*-actual.png`、`*-expected.png` 找出原因（多半是意外的樣式回歸，或測試沒等到非同步內容）。
- 更新指令（只在 macOS 上跑；可加 `-g <畫面名>` 只更新特定畫面）：
  ```bash
  pnpm test:visual --update-snapshots
  ```
  更新後再跑一次 `pnpm test:visual` 確認全過，並用 `git status` 確認只動到預期的 png。
- PR 要附差異說明：有更新基準的 PR，內文列出改了哪幾張基準、為什麼改（對應哪個畫面調整），並附改前／改後截圖或 `*-diff.png`；沒有說明的基準更新不要合併。
