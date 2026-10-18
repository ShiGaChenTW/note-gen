---
title: NoteGen Fork 偏離上游清單
filename: FORK-CHANGES.md
created: 2026-10-15 05:45 (Asia/Taipei)
modified: 2026-10-19 00:08 (Asia/Taipei)
source_llm: Claude (Opus 5.5, Claude Code session)
status: active
---

# NoteGen Fork 偏離上游清單

> 所有跟 `codexu/note-gen` 不同的修改都記在這裡。合併上游時先看這份，衝突以這裡列的修改為準。

## Git 結構

| 名稱 | 指向 | 用途 |
|---|---|---|
| remote `origin` | `ShiGaChenTW/note-gen` | 個人 fork |
| remote `upstream` | `codexu/note-gen` | 官方上游 |
| branch `dev` | 個人主線 | 日常開發 |
| branch `upstream-dev` | 追蹤 `upstream/dev` | 純鏡像，不放個人 commit |

分岔點：上游 `9859c6ef`（v0.38.2）。

## 同步上游流程

```bash
git fetch upstream
git checkout upstream-dev && git merge --ff-only upstream/dev
git checkout dev && git merge upstream-dev   # 或 cherry-pick 個別 commit
npx pnpm@9 install --frozen-lockfile
```

## 修改清單

| 日期 | 檔案 | 修改 | 原因 |
|---|---|---|---|
| 2026-10-15 | `src-tauri/tauri.conf.json` | `identifier` → `tw.scottchen.NoteGen`、`productName` → `NoteGen (Scott)` | 資料目錄與官方版分開，可並存（D1） |
| 2026-10-15 | `src-tauri/tauri.conf.json` | `plugins.updater.endpoints` → `[]` | 防止自動更新把 fork 換回官方版（D4）。「關於」頁按檢查更新會顯示錯誤，屬預期 |
| 2026-10-15 | `personal/` | 新增：個人文件、custom CSS、NoteGen Today 插件 | D6 |
| 2026-10-15 | `.mcp.json`、`.ignore`、`.gitignore` | graft 程式碼索引設定 | 本機開發工具 |
| 2026-10-17 | `src/lib/markdown/frontmatter-split.ts`（新） | frontmatter 切分與拼回，`block + body === raw` | F1：共用的 frontmatter 規則 |
| 2026-10-17 | `src/app/core/main/editor/markdown/frontmatter-extension.ts`（新） | Tiptap `frontmatter` 節點：載入前把 YAML 換成標記，存檔時原樣輸出 | F1：原本 `---` 被讀成分隔線，第一個 key 被讀成 `## 標題`，存檔就改壞 frontmatter |
| 2026-10-17 | `src/app/core/main/editor/markdown/tiptap-editor.tsx` | 掛載點：import、extensions 加 `Frontmatter`、3 處 `setContent` 包 `encodeFrontmatterForEditor()` | F1 |
| 2026-10-17 | `src/app/core/main/editor/markdown/section-document.ts` | `findFrontmatterRange` 改呼叫共用的 `findFrontmatterEnd` | F1：大檔模式與一般模式同一套規則 |
| 2026-10-17 | `src/app/core/main/editor/markdown/style.css` | 檔尾加 `.notegen-frontmatter` 樣式 | F1：frontmatter 以唯讀區塊顯示 |
| 2026-10-17 | `package.json`、`pnpm-lock.yaml`、`vitest.config.ts`（新）、`tests/`（新） | 加 `vitest`、`jsdom` 與 `test` script | 上游沒有測試框架；往返測試用 |
| 2026-10-17 | `.gitignore` | 在上游的 `*.test.*` 之後加 `!src/**/*.test.ts`、`!tests/**/*.test.ts` | 上游忽略所有測試檔，fork 的 vitest 測試要進版控 |
| 2026-10-17 | `src/lib/daily/`（新） | F2 日期與檔名、D1 模板引擎、任務與 Daily Note 解析、D4 自然語言、D5 重複任務、今日筆記內容與開啟服務 | Phase 1 純函式與 I/O，全部是新檔 |
| 2026-10-17 | `src/stores/daily-settings.ts`（新） | 日記設定存在 `store.json` 的 `dailySettings` key | D1：不改上游的 `setting.ts` |
| 2026-10-17 | `src/app/core/setting/daily/page.tsx`（新） | 設定頁「日記」分區 | D1 |
| 2026-10-17 | `src/stores/settings-dialog.ts`、`src/app/core/setting/config.tsx`、`src/app/core/setting/components/settings-dialog.tsx` | 掛載點：加 `daily` 分區、導覽項目、頁面對應 | D1 |
| 2026-10-17 | `messages/{en,zh,zh-TW,ja,de,pt-BR}.json` | 在 `settings.record` 前加 `settings.daily` | D1 |
| 2026-10-17 | `src/app/core/main/daily-note-auto-open.tsx`（新）、`src/app/core/main/page.tsx` | 啟動時開啟今日筆記；page 只加 import 與一行掛載 | D1 |
| 2026-10-18 | `src/lib/vault-index/`（新）、`src/stores/vault-index.ts`（新） | vault 索引：任務行、frontmatter、mtime；快取存在 AppData `vault-index/`，不寫進 vault；用 fs watch 增量更新 | F3 |
| 2026-10-18 | `src/app/core/main/fork-services.tsx`（新）、`src/app/core/main/page.tsx` | fork 背景服務統一從 `<ForkServices />` 掛載（F3 索引＋D1 自動開啟）；page 仍只有一行 import 與一行掛載 | F3 |
| 2026-10-18 | `src/lib/today/`（新）、`src/app/core/main/today/`（新）、`src/lib/daily/note-io.ts`（新） | D2 原生今日頁（設計 v2）：任務分組（逾期＋近三日）、今日進程、本週、勾選寫回與復原、早晨啟動／整日復盤、D6 帶入今天 | D2、D6 |
| 2026-10-18 | `src/app/core/main/editor/editor-layout.tsx` | 掛載點：`blank://fork-today` 分頁改畫 `<TodayPage />`；呼叫 `useTodayTabOpener`（共 8 行） | D2：沿用上游 blank 分頁機制，不新增分頁種類 |
| 2026-10-18 | `src/app/core/main/main-status-bar.tsx` | 掛載點：狀態列「需處理 N」 | D2 |
| 2026-10-18 | `messages/*.json` | 新增頂層 `today` 命名空間（6 語系） | D2 |
| 2026-10-18 | `src-tauri/native-calendar/`（新）、`src-tauri/src/calendar.rs`（新）、`build.rs`、`lib.rs`、`tauri.conf.json`、`Info.plist`、`Entitlements.plist`、`.gitignore` | macOS 行事曆唯讀：Swift EventKit 小工具（比照 OCR 由 build.rs 編譯、放 `resources/calendar/`），Rust 指令 `calendar_events`／`calendar_request_access`；補行事曆用途說明與 entitlement | D2：Scott 決定 Phase 1 接行事曆 |
| 2026-10-18 | `src/app/core/main/daily/`（新）、`src/lib/daily/daily-nav.ts`（新）、`open-daily-note.ts` | D3 日記導航：前一篇／後一篇日記（跳過沒有日記的日子，往今天走時停在今天）、月曆跳日期（有日記灰點、有任務到期琥珀點）、快捷鍵 `⌘⌥[`／`⌘⌥]` | D3 |
| 2026-10-18 | `src/app/core/main/main-status-bar.tsx` | 掛載點：狀態列加 `fork:daily-nav`（開著日記時顯示「‹ 日期 ›」，其他時候只有月曆按鈕） | D3 |
| 2026-10-18 | `src/app/core/main/today/quick-add.tsx`（新）、`src/lib/today/today-actions.ts` | D4 快速新增：今日頁任務區的輸入框，即時預覽解析結果，Enter 寫進今日筆記「捕捉軌」區塊最後 | D4：Inbox 資料夾不在任務索引範圍內，所以只寫今日筆記 |
| 2026-10-18 | `src/app/core/main/editor/markdown/recurring-task-extension.ts`（新）、`tiptap-editor.tsx` | D5：在編輯器勾選 `🔁` 任務時加上 `✅ 今天`，下一行產生下一次；只認單一勾選動作，載入 Obsidian 已勾好的檔案不會重複產生。`tiptap-editor.tsx` 只加 import 與 extensions 一行 | D5：今日頁勾選在 D2 已接好，這次補編輯器 |
| 2026-10-18 | `src/lib/reminders/`（新）、`src/app/core/main/daily/reminder-service.tsx`（新）、`src/stores/daily-settings.ts`、`src/app/core/setting/daily/page.tsx` | D7 提醒：每分鐘檢查 `⏰` 任務並發 macOS 通知，App 關掉期間錯過的打開時補發（最多 24 小時，超過 3 個合併成一則）；已通知紀錄存在 AppData 的 `reminders.json`；設定頁加開關與「傳送測試通知」 | D7 |
| 2026-10-18 | `src/app/core/main/today/time-blocks.tsx`（新）、`src/lib/today/schedule.ts`（新） | D8 時間區塊：今日進程可切換「清單／時間軸」，把任務拖到時間軸寫入 `📅 今天 ⏰ HH:mm`（15 分鐘一格），時間軸上的任務可再拖動；任務列的時鐘按鈕是鍵盤替代方式 | D8 |
| 2026-10-18 | `messages/*.json` | `today` 加 `calendarNav`、`quickAdd`、`timeBlocks`、`reminders` 等；`settings.daily` 加 `reminders` | D3、D4、D7、D8 |
| 2026-10-19 | `personal/make-test-vault.mjs`（新） | 產生測試用 vault（預設 `~/Documents/NoteGen-Test-Vault`），日期以執行當天為今天，涵蓋 F1、D1–D8 的測試情境；只會覆寫自己建立的 vault | 驗收用，不動真正的 vault |

## 刻意不改的東西

- `.github/workflows/*`：`release.yml`、`publish-config.yml` 只能手動觸發，`plugin-contract.yml` 只在 PR 跑檢查，不會自動發佈。保留原檔，減少合併衝突。
- `deep-link` scheme `notegen`：Web Clipper 擴充依賴這個名稱。如果同一台機器同時裝官方版，macOS 只會把連結交給其中一個。
- Mobile（iOS / Android）設定：只維護 macOS（D5）。

## 開發環境注意

- **pnpm 用 9 版**（跟上游 CI 一致）：`npx pnpm@9 install --frozen-lockfile`。pnpm 10+ 會擋 build script，而且會忽略 `package.json` 的 `pnpm.overrides`（`@lezer/common`），改寫 lockfile。
- 桌面版 build 需要 Rust（`rustup`）。
- **Rust 用 stable，不用 repo 指定的 1.88.0**：macOS 27 的 dyld 拒絕載入 1.88.0 編出的 proc-macro（`sqlx-macros` 報 `mis-aligned LINKEDIT string pool`）。本機用 `rustup override set stable` 蓋過 `rust-toolchain.toml`，不改 repo 檔案。1.99.0 驗證可 build。
- 本機 build：`npx pnpm@9 tauri build --bundles app` → `src-tauri/target/release/bundle/macos/NoteGen (Scott).app`。

## 測試步驟

### 今日頁（D2）與 macOS 行事曆

**啟動**（分支 `feat/d2-today-page` 或之後的分支；確定 port 3456 沒被其他 dev server 佔用）：

```bash
source "$HOME/.cargo/env"
npx pnpm@9 tauri dev
```

第一次啟動會由 `build.rs` 編譯行事曆小工具，需要幾分鐘。

**測試前**：勾選、帶入、標記都會直接寫進 vault。建議改用測試 vault：`node personal/make-test-vault.mjs`（已存在時加 `--force` 重建），再到設定把工作區切到 `~/Documents/NoteGen-Test-Vault`。

**今日頁**

1. 開啟：點底部狀態列右側的「需處理 N」或「今日」，分頁列最左邊出現「今日」分頁。
2. 頂列：日期、問候語、時間正確；點本週任一天，開啟那天的日記，不存在時依模板建立。
3. 唯一要務／三件 MIT：顯示今日日記的對應區塊，沒填時顯示「尚未填寫」；改日記存檔後幾秒內更新。
4. 任務清單：分成逾期、今天、明天、後天、今天完成；逾期項目顯示「逾期 N 天」，高優先度顯示「高」。
5. 勾選任務：原筆記那一行變成 `[x]` 並加上 `✅ 今天日期`；按提示的「復原」會還原。勾帶 `🔁` 的任務時，下一行會多出下一次的任務。
6. 帶入今天（D6）：昨天日記有未完成任務時出現琥珀色提示；按「帶入今天」後，任務移到今日筆記的「捕捉軌」區塊最後，昨天那行變成 `- 原文字 → [[今天]]`。
7. 「⋯」選單：早晨啟動／整日復盤會在今日筆記寫入 `morning:: done`／`reviewed:: done`；「重新掃描 vault」會重讀索引。
8. 窄寬度：分割編輯區（`Cmd+\`）讓今日分頁變窄，版面改成單欄。

**行事曆**

1. 今日進程顯示「連接 macOS 行事曆…」，按「連接行事曆」。
2. `tauri dev` 不是打包好的 App，系統權限詢問會以啟動它的終端機 App（例如 Terminal、iTerm）名義跳出。允許後，今天的非全天事件依時間排進進程，標示日曆名稱。
3. 拒絕過或沒跳出詢問：到「系統設定 → 隱私權與安全性 → 行事曆」開啟該終端機 App，再切回 NoteGen 視窗，切回時會重新讀取。
4. 打包版（`npx pnpm@9 tauri build --bundles app`）才會用 `Info.plist` 裡「NoteGen 會在『今日』頁顯示你今天的行事曆事件」的說明，權限也記在 NoteGen 名下。

**這份步驟沒涵蓋的**

- F3 首次掃描時間：看開發者工具 Console 的 `[vault-index] N files in Xms`。
- 打包版的行事曆權限流程。

### 時間管理（D3、D4、D5、D7）與時間區塊（D8）

啟動方式同上。這些動作同樣會寫進 vault，先確認 vault 已備份或 git 狀態乾淨。

**D3 日記導航**

1. 打開任一篇日記，狀態列右側出現「‹ 10月18日 週日 ›」。
2. 按 `‹`／`›` 或 `⌘⌥[`／`⌘⌥]`：跳到前一篇／後一篇已存在的日記，中間沒有日記的日子會跳過；往今天的方向走時會停在今天（今天的日記不存在就依模板建立）。到最早一篇再按會提示「沒有更多日記了」。
3. 點日期打開月曆：有日記的日子有灰點，有未完成任務到期的日子有琥珀點；點任一天打開那天的日記（不存在就建立），「今天」按鈕回到今天。
4. 今日頁本週列的最右邊也有月曆按鈕，行為相同。

**D4 快速新增**

1. 今日頁任務區最上方的輸入框輸入 `買菜 @明天 9am !high #家`，下方即時顯示：買菜、明天的日期、09:00、高、家。
2. 按 Enter：今日筆記「捕捉軌」區塊最後多出 `- [ ] 買菜 📅 YYYY-MM-DD ⏰ 09:00 ⏫ #家`；按提示的「復原」會移除。
3. 再試 `回信 @下週五`、`開會 下午3點`、`繳費 @25號`。

**D5 重複任務（編輯器）**

1. 在任一筆記寫 `- [ ] 澆花 🔁 every week 📅 今天日期`，在編輯器裡勾選。
2. 這行變成 `- [x] … ✅ 今天日期`，下一行出現 `- [ ] 澆花 🔁 every week 📅 下週同一天`。按 `⌘Z` 一次會連同新的那行一起復原。
3. 今日頁勾選 `🔁` 任務時，提示會寫「已完成，下一次 YYYY-MM-DD」。

**D7 提醒**

1. 設定 →「日記」→「提醒」：開關預設開啟。按「傳送測試通知」，第一次會跳出通知權限詢問（`tauri dev` 下以終端機 App 名義），允許後收到測試通知。
2. 在今日筆記寫 `- [ ] 測試提醒 📅 今天日期 ⏰ 兩分鐘後的時間`，存檔後等到那個時間，一分鐘內收到「⏰ HH:mm 任務提醒」。
3. 補發：再寫一個 ⏰ 五分鐘後的任務，關掉 App，過了時間再打開，App 載入完成後收到那則提醒。
4. 同一個提醒不會重複通知；關掉開關期間到點的提醒，重新打開開關後不會補發。

**D8 時間區塊**

1. 今日頁「今日進程」右上角切到「時間軸」，看到 07:00–22:00 的時間格與「現在」線；錨點時段、⏰ 任務、行事曆事件依時間排上去，重疊的會並排。
2. 從右邊任務清單拖一個任務到時間軸：出現虛線與對齊 15 分鐘的時間，放開後原筆記那行改成 `📅 今天 ⏰ HH:mm`，任務出現在時間軸上。
3. 把時間軸上的任務拖到別的時間，⏰ 跟著改；按提示的「復原」會還原。
4. 鍵盤：滑鼠移到任務列（或用 Tab）會出現時鐘按鈕，選時間後按「排入」；已有時間的任務可以「清除時間」（不改到期日）。

**這份步驟沒涵蓋的**

- 打包版的通知權限（會記在 NoteGen 名下）。
- 時間軸拖放只支援滑鼠或觸控板；用鍵盤時改用任務列的時鐘按鈕。
