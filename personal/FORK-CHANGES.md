---
title: NoteGen Fork 偏離上游清單
filename: FORK-CHANGES.md
created: 2026-10-15 05:45 (Asia/Taipei)
modified: 2026-10-17 04:10 (Asia/Taipei)
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

## 刻意不改的東西

- `.github/workflows/*`：`release.yml`、`publish-config.yml` 只能手動觸發，`plugin-contract.yml` 只在 PR 跑檢查，不會自動發佈。保留原檔，減少合併衝突。
- `deep-link` scheme `notegen`：Web Clipper 擴充依賴這個名稱。如果同一台機器同時裝官方版，macOS 只會把連結交給其中一個。
- Mobile（iOS / Android）設定：只維護 macOS（D5）。

## 開發環境注意

- **pnpm 用 9 版**（跟上游 CI 一致）：`npx pnpm@9 install --frozen-lockfile`。pnpm 10+ 會擋 build script，而且會忽略 `package.json` 的 `pnpm.overrides`（`@lezer/common`），改寫 lockfile。
- 桌面版 build 需要 Rust（`rustup`）。
- **Rust 用 stable，不用 repo 指定的 1.88.0**：macOS 27 的 dyld 拒絕載入 1.88.0 編出的 proc-macro（`sqlx-macros` 報 `mis-aligned LINKEDIT string pool`）。本機用 `rustup override set stable` 蓋過 `rust-toolchain.toml`，不改 repo 檔案。1.99.0 驗證可 build。
- 本機 build：`npx pnpm@9 tauri build --bundles app` → `src-tauri/target/release/bundle/macos/NoteGen (Scott).app`。
