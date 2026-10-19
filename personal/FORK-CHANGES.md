---
title: NoteGen Fork 偏離上游清單
filename: FORK-CHANGES.md
created: 2026-10-15 05:45 (Asia/Taipei)
modified: 2026-10-19 17:17 (Asia/Taipei)
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
| 2026-10-19 | `src/app/core/main/today/use-today-data.ts`（新）、`use-today-actions.ts`（新）、`today-page.tsx` | 重構：今日頁的資料讀取與寫回動作抽成兩個 hook，`TodayPage` 只負責畫面；行為不變 | graphify 指出 `TodayPage` 直接呼叫 37 個函式 |
| 2026-10-19 | `src/lib/markdown/wikilink.ts`（新） | Phase 2 共用：`[[ ]]` 解析（別名、`\|`、`#標題`、`^block`、嵌入）、全文搜尋（跳過 code）、Obsidian「shortest path」目標解析與寫法 | Phase 2-1 三條軌道共用；規格 `personal/specs/07-Phase2-1實作規格.md`（`docs/notegen-plan/07` 的版控副本） |
| 2026-10-19 | `src/lib/vault-index/index-note.ts`、新檔 `links.ts`、`src/stores/vault-index.ts` | 索引 `links`（wikilink＋相對 markdown 連結，含行號、上下文）、`aliases`、`tags`（frontmatter＋內文 `#tag`，允許 `-`／`_`）；`INDEX_SCHEMA_VERSION` 2，舊快取自動重建；`selectBacklinks`／`selectOutgoingLinks` 按路徑快取 | L3（Codex 實作） |
| 2026-10-19 | `src/app/core/main/backlinks/`（新）、`src/components/plugins/plugin-right-sidebar.tsx` | 右側欄「反向連結」tab：連結到這篇（依來源筆記分組、強調連結文字、點擊開啟）、本篇連出（標示尚未建立）。掛載點：加 `@backlinks` tab，沒有外掛時也畫 Tabs（原本直接回 `<Chat />`） | L3 |
| 2026-10-19 | `src/lib/wikilink-suggest-model.ts`（新）、`src/app/core/main/editor/markdown/wikilink-suggest.tsx`（新）、`tiptap-editor.tsx` | L2：輸入 `[[` 跳出筆記選單（名稱／別名前綴 > 子序列 > 路徑；空 query 列已開分頁），Enter／Tab 插入 `[[目標]]` 或 `[[目標|別名]]`，最後一列「建立」；`tiptap-editor.tsx` 只加 import 與掛載一行 | L2（Grok 實作） |
| 2026-10-19 | `messages/*.json` | 頂層 `backlinks` 命名空間（`today` 之後）、`editor.wikilinkSuggest`（`smartFileLink` 之後） | L2、L3 |
| 2026-10-19 | `src/app/core/main/editor/markdown/wikilink-extension.ts`（新）、`tiptap-editor.tsx`、`markdown/style.css`、`tests/l1-wikilink-roundtrip.test.ts`（新） | L1：`[[ ]]`／`![[ ]]` 成為 inline atom 節點，存檔輸出原始字串；表格內 `\|` 由附帶的 block tokenizer 還原（只對含 `[[` 的表格出手；上游 marked 會把 `\|` 切成 `|`，這是目前唯一真的會改壞檔案的情境）；已建立／未建立用 decorations 跟隨索引；點擊開啟、不存在則在同資料夾建立 `名稱.md`；打完 `]]` 的 input rule 轉成節點。`tiptap-editor.tsx` 加 import 與 extensions 一行、L2 掛載兩行 | L1（Claude Code 子代理實作）；已知上游限制：`**粗體 [[B]]**` 會存成 `**粗體** [[B]]`（@tiptap/markdown 只把 mark 套在 text node，InlineMath 同病），測試以 `it.fails` 記錄 |
| 2026-10-19 | `tests/p2-1-wikilink-integration.test.ts`（新） | 整合：手打 `]]` 轉節點、L2 選單直接插入 L1 節點（連既有 `]]` 一起換掉） | PM 整合 |
| 2026-10-19 | `src/lib/note-rewrite.ts`（新） | Phase 2-2 共用：改寫可能正在編輯器裡開著的筆記（`runEditorPathWriteTransaction` 排隊、寫前重讀、開著的那篇寫完發 `editor-file-content-updated`／`external-content-update` 讓編輯器重載、失敗整批還原），照上游 `markdown-media-path.ts` 的流程 | 2-2 三軌寫檔的唯一入口；規格 `personal/specs/08-Phase2-2實作規格.md` |
| 2026-10-19 | `src/lib/vault-index/tags.ts`（新）、`src/stores/vault-index.ts`、`src/app/core/main/note-tags/`（新） | L6 筆記標籤：以索引的 `tags` 建樹（`/` 分層、不分大小寫、去重計數）、搜尋、依名稱／數量排序、點標籤列筆記；store 檔尾加 `selectTagTree` | L6（Grok 實作）；與上游「記錄」的標籤表完全分開 |
| 2026-10-19 | `src/stores/sidebar.ts`、`src/app/core/main/left-sidebar.tsx` | 掛載點：內建左側欄 tab 加 `noteTags`（lucide `Hash`，放在畫布之後）；`SidebarSearch` 不涵蓋這個 tab | L6 |
| 2026-10-19 | `src/lib/markdown/frontmatter-edit.ts`（新）、`src/lib/obsidian-types.ts`（新）、`src/app/core/main/properties/`（新） | L5 屬性面板：用 `yaml` `parseDocument` 的節點 range 做文字替換，只改動到的 key（註解、引號、順序、CRLF 不動）；八種 Obsidian 型別，優先讀 vault 的 `.obsidian/types.json`（唯讀）；巢狀、多行、錨點唯讀；各型別編輯元件、新增屬性 key 自動完成（全 vault 索引）、原始碼模式；寫回走 `rewriteNote` | L5（Codex 實作）；已知：被改的那一行若有行尾註解，註解前的多個空白會縮成一個；flow 清單被改時轉 block |
| 2026-10-19 | `src/components/plugins/plugin-right-sidebar.tsx` | 掛載點：右側欄加 `@properties` tab（lucide `SlidersHorizontal`，放在反向連結之後） | L5 |
| 2026-10-19 | `src/lib/markdown/wikilink-rewrite.ts`（新）、`src/lib/wikilink-rename.ts`（新）、`src/app/core/main/link-rewrite/`（新）、`fork-services.tsx` | L7 改名改寫連結：改名／搬動後用索引篩出連到被搬動檔案的筆記，比較搬動前後的解析結果，只改真的會指錯的連結（保留 `#標題`、`\|別名`、嵌入、frontmatter 引號內；markdown 相對連結重算）；補上「相對本篇資料夾的部分路徑」解析；AlertDialog 每次詢問；改寫走 `rewriteNotes`，失敗還原但不回滾改名 | L7（Claude Code 子代理實作）；2-1 的「部分路徑不解析」限制在 L7 的解析器已補，L1 的 decorations 仍用舊 resolver（2-3 統一） |
| 2026-10-19 | `src/app/core/main/file/file-item.tsx`、`file-dnd.ts`、`folder-item/index.tsx` | 掛載點：各加 1 行 import 與 2 行 `await requestLinkRewrite(...)`，放在上游 `rewriteWorkspaceMarkdownMediaPaths` 之後、外層 try 之內；函式內部 catch，不觸發上游 rollback | L7 |
| 2026-10-19 | `src/lib/markdown/unlinked-mentions.ts`（新）、`src/lib/vault-index/unlinked-mentions-scan.ts`（新）、`src/app/core/main/backlinks/backlinks-panel.tsx` | L4 未連結提及：反向連結面板第三區（預設收合、展開時才掃描全 vault、依索引 revision 快取、索引變動後改按「掃描」重掃）；純字串比對（ASCII 邊界、CJK 不設邊界，跳過 code／`[[ ]]`／markdown 連結／frontmatter／URL／`#tag`）；「連結」「全部連結」改寫為 `[[目標]]` 或 `[[目標|原文字]]` | L4（Claude Code 子代理實作） |
| 2026-10-19 | `messages/*.json` | 頂層 `linkRewrite`（`today` 之後）、`backlinks` 尾端 8 個未連結提及 key、頂層 `properties`（`backlinks` 之後）、頂層 `noteTags`（`tags` 之後）、`navigation.noteTags` | L4、L5、L6、L7 |
| 2026-10-19 | `personal/make-test-vault.mjs` | `60 Notes/` 加 2-2 樣本：`.obsidian/types.json`、屬性樣本、標籤 A／B／C、待改名與三篇改名來源、提及目標與兩篇提及來源 | 驗收用 |

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

### Phase 2-1 基本雙鏈（L1 wikilink、L2 自動完成、L3 反向連結）

啟動方式同上。測試 vault：`node personal/make-test-vault.mjs --force`，雙鏈樣本在 `60 Notes/`（見該 vault 的 README）。

**L1 wikilink**

1. 開一篇含 `[[筆記]]`、`[[筆記|別名]]`、`[[筆記#標題]]`、`![[圖.png]]` 的筆記：連結顯示為琥珀色底線文字（別名優先），嵌入顯示 `⧉ 檔名` 的虛線框。
2. 指向不存在筆記的連結是虛線、較淡；建好那篇筆記後幾秒內虛線消失（索引 watcher）。
3. 點既有連結：左側檔案樹 reveal 並開啟那篇；點不存在的連結：在目前筆記同資料夾建立 `名稱.md`（內容 `# 名稱`）並開啟；`[[#標題]]` 與嵌入點了不動作。
4. **存檔 diff 為空**：開 `60 Notes/雙鏈來源.md` 不改內容只按存檔，再用 git 或 Obsidian 比對，必須是空的（含行內 code `` `[[x]]` ``、frontmatter `related: "[[Front]]"`、markdown 相對連結）。`60 Notes/雙鏈表格.md`：只允許表格欄寬補空白與表前多一個空行，`[[A\|a]]` 的 `\|` 必須還在。
5. 方向鍵會跳過整個連結，Backspace 整個刪掉。手動打 `[[新連結]]`，打完第二個 `]` 立刻變成節點。

**L2 自動完成**

1. 輸入 `[[` 出現選單：名稱前綴命中的在前，別名命中的有「別名」badge，淡色顯示資料夾；空 query 時列出已開分頁的筆記。
2. ↑↓ 選擇、Enter 或 Tab 送出：插入 `[[筆記]]`（同名筆記存在時寫完整路徑 `[[folder/筆記]]`）；用別名選到時是 `[[筆記|別名]]`。Esc 關閉。
3. 游標後面已有 `]]` 時不會多出一組。
4. 打一個不存在的名稱，最後一列「建立「名稱」」：送出後插入 `[[名稱]]`（虛線），點它才建立檔案。

**L3 反向連結**

1. 右側欄多一個鏈結圖示的 tab「反向連結」（沒有安裝任何外掛時也有）。
2. 開一篇被其他筆記連到的筆記：「連結到這篇 N」依來源筆記分組，每筆顯示那一行的上下文並強調連結文字；點一筆開啟來源筆記。相對路徑的 markdown 連結 `[文字](../筆記.md)` 也算。
3. 「本篇連出 N」列出這篇的連結，尚未建立的標「尚未建立」。
4. 索引掃描中顯示「索引中…」；開的不是 `.md` 時顯示提示。
5. 第一次啟動會因 `INDEX_SCHEMA_VERSION` 升到 2 而整份重建索引，Console 看 `[vault-index]` 時間。

**這份步驟沒涵蓋的**

- 嵌入 `![[ ]]` 的內容轉入、`#標題` 捲動、block ref 跳轉（Phase 2-3）。
- 跨連結套粗體／斜體的存檔差異（上游限制，見修改清單）。
- **表格存檔會被重排**：上游 @tiptap/markdown 的表格序列化器會把欄寬補齊（`|---|---|` 變 `| --- | --- |`、儲存格補空白）並在表格前多放一個空行；不開 Wikilink 擴充也一樣，所有含表格的筆記都受影響，與 2-1 無關。要達成「表格也一字不差」需要另開小 PR 在存檔路徑還原原始表格文字。
- **部分路徑不解析**：`resolveWikilinkTarget` 只認「從 vault 根目錄的完整路徑」或「純檔名」，`[[子資料夾/同名]]` 這種相對於本篇資料夾的部分路徑（Obsidian「Relative path to file」連結格式）會標成未建立。2-1 假設 vault 用 Obsidian 預設的「Shortest path when possible」；2-2 再補相對路徑解析。

### Phase 2-2 知識庫整理（L5 屬性面板、L7 改名改寫連結、L6 筆記標籤、L4 未連結提及）

啟動方式同上。測試 vault：`node personal/make-test-vault.mjs --force`，樣本在 `60 Notes/`，預期數字見該 vault 的 README。驗收前先在 Obsidian 開同一個 vault 一次，確認 `.obsidian/types.json` 是腳本放的那份（Obsidian 可能會改寫它）。

**L5 屬性面板**

1. 右側欄多一個滑桿圖示的 tab「屬性」（對話、反向連結之後）。開 `60 Notes/屬性樣本.md`：列出 9 個屬性，`due` 是日期、`reviewed` 是日期時間、`rating` 數字、`done` 核取、`related`／`tags`／`aliases` 是 chip 列、`nested` 顯示原文並標「不支援」。
2. 改 `rating` 為 5、勾 `done`、改 `title`：每次存檔後 `git diff` 只有那一行；`title` 行尾的 `# 行尾註解要留著` 仍在（註解前空白會縮成一個）。
3. `tags` 加一個 chip：那段從 `[notegen, phase-2]` 變成 block 清單（三行），其他行不動。刪掉 `aliases` 的唯一一個值：變成 `aliases: []`。
4. 「新增屬性」打 `due`：下拉有 vault 裡出現過的 key，型別自動顯示「日期」（來自 `types.json`）。新 key 加在 `nested` 區塊之後、`---` 之前。
5. 「原始碼」：改壞 YAML 按套用會顯示錯誤、不寫檔；改好再套用整塊替換。
6. 編輯器同時開著這篇：改屬性後編輯器畫面上的 frontmatter 區塊即時更新，游標不跳。開著「今日頁」或非 `.md` 時面板顯示提示。

**L6 筆記標籤**

1. 左側欄多一個 `#` 圖示的 tab「筆記標籤」（畫布之後）；索引中顯示「索引中…」。
2. 樹：`專案`（3）展開有 `alpha`（1）、`beta`（1）；`閱讀` 2；`Reading` 2（`#Reading` 與 `#reading` 合併，顯示第一次遇到的寫法）；`待辦` 1；frontmatter 的 `notegen`、`phase-2` 也在。code 內的 `#code裡的不算` 不出現。
3. 點 `專案`：下方列 標籤A、標籤B、標籤C（含子標籤的筆記）；點 `alpha` 只有標籤A。點筆記會開啟。
4. 搜尋框打 `alp`：只剩 `專案 › alpha`，祖先自動展開；「依數量」切換排序。
5. 這個 tab 與上游「記錄」頁的標籤互不影響。

**L7 改名改寫連結**

1. 在檔案樹把 `60 Notes/待改名.md` 改名為 `新名字`：跳出「更新連結」對話框，寫「4 篇筆記共 10 個連結」，列出 改名來源一（5）、改名來源二（2）、子資料夾/改名來源三（2）、屬性樣本（1）。
2. 按「改寫」：toast「已更新 4 篇筆記」。`git diff`：改名來源一只有 5 行變（frontmatter 引號內、一般、別名、標題、嵌入），行內 code 的 `[[待改名]]` 不變；改名來源二的表格 `[[新名字\|表格別名]]` 保留 `\|`，markdown 連結變 `(新名字.md)`，檔案仍是 CRLF；來源三的 `[連結](../新名字.md)`；屬性樣本的 `related` 那一行。
3. 把改名後的檔案拖進 `子資料夾/`：對話框只列 markdown 連結會變的檔案（來源二、來源三、被搬動的那篇自己的 `[雙鏈目標](../雙鏈目標.md)`）；`[[新名字]]` 這種 wikilink 不列、不改（shortest path 不受資料夾影響）。
4. 按「不改寫」：什麼都不動，連結變虛線（未建立）。
5. 改名整個 `60 Notes/` 資料夾：只有寫完整路徑的 `[[60 Notes/子資料夾/同名]]` 會改，`[[同名]]` 不動。
6. 被連到的筆記正開在編輯器裡時改名另一篇：編輯器內容即時更新、不會出現「檔案已變更」衝突。改寫失敗（例如改寫期間編輯器還有未存檔的輸入）會 toast「改寫失敗，檔案已還原」，改名本身維持成功。

**L4 未連結提及**

1. 開 `60 Notes/提及目標.md`，右側欄「反向連結」最下方「未連結提及」預設收合；展開顯示「掃描中…」然後列出 4 筆：提及來源（純文字 1、別名「提及別名」1）、提及來源二（標題 1）、README（1）。已是 `[[ ]]`、code、markdown 連結裡的不算；`Note` 不命中 `Notes`。
2. 按某一筆的「連結」：那一筆消失、toast「已轉成連結」，`git diff` 只有那一行，純文字變 `[[提及目標]]`，別名那筆變 `[[提及目標|提及別名]]`；幾秒後索引更新，它出現在「連結到這篇」。
3. 「全部連結」一次改同一篇的多筆；改完後區塊上方出現「掃描」按鈕（索引變了不自動重掃），按下重掃。

**這份步驟沒涵蓋的**

- L5：Properties 的 Visible／Hidden 模式、寫入 `types.json`、Dataview 行內欄位；YAML 錨點／別名／多行字串只能用原始碼改。
- L7：指向非 `.md` 附件（PDF 等）的連結不在索引裡，改名附件不會改寫（圖片由上游處理）；`[text](Note)` 省略 `.md` 的 markdown 連結不會跟著搬；「記住選擇」設定沒做，每次都問。
- L4：純字串比對，很短或很常見的名稱會命中很多；每次展開都讀全 vault 的 `.md`，3,000 篇以內可接受。
- 索引的內文 `#tag` 只認行首或空白／括號之後的 `#`，緊接在標點後的（`，#待辦`）不算，純數字 `#12` 會被當成標籤（Obsidian 不會）：2-3 修索引時一併處理。
- 上游表格序列化器重排（見 2-1）仍未處理。
