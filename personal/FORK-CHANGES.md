---
title: NoteGen Fork 偏離上游清單
filename: FORK-CHANGES.md
created: 2026-10-15 05:45 (Asia/Taipei)
modified: 2026-10-15 06:30 (Asia/Taipei)
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

## 刻意不改的東西

- `.github/workflows/*`：`release.yml`、`publish-config.yml` 只能手動觸發，`plugin-contract.yml` 只在 PR 跑檢查，不會自動發佈。保留原檔，減少合併衝突。
- `deep-link` scheme `notegen`：Web Clipper 擴充依賴這個名稱。如果同一台機器同時裝官方版，macOS 只會把連結交給其中一個。
- Mobile（iOS / Android）設定：只維護 macOS（D5）。

## 開發環境注意

- **pnpm 用 9 版**（跟上游 CI 一致）：`npx pnpm@9 install --frozen-lockfile`。pnpm 10+ 會擋 build script，而且會忽略 `package.json` 的 `pnpm.overrides`（`@lezer/common`），改寫 lockfile。
- 桌面版 build 需要 Rust（`rustup`）。
- **Rust 用 stable，不用 repo 指定的 1.88.0**：macOS 27 的 dyld 拒絕載入 1.88.0 編出的 proc-macro（`sqlx-macros` 報 `mis-aligned LINKEDIT string pool`）。本機用 `rustup override set stable` 蓋過 `rust-toolchain.toml`，不改 repo 檔案。1.99.0 驗證可 build。
- 本機 build：`npx pnpm@9 tauri build --bundles app` → `src-tauri/target/release/bundle/macos/NoteGen (Scott).app`。
