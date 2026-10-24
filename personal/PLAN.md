---
title: NoteGen 個人 Fork 開發計畫
filename: PLAN.md
created: 2026-10-15 05:10 (Asia/Taipei)
modified: 2026-10-19 21:00 (Asia/Taipei)
source_llm: Claude (Opus 5.5, Claude Code session)
status: approved 2026-10-15（D1–D6 全採建議）
supersedes: HANDOFF.md 第 1、3、9 節的「純 CSS / 插件沙箱」前提
---

# NoteGen 個人 Fork 開發計畫

## 0. 結論

- 本資料夾已是 fork（`ShiGaChenTW/note-gen`，`dev` 分支，app v0.38.2），後續**個人維護**。
- 最大的改變：**之前的限制大多不再存在**。以前只能用 custom CSS 和插件沙箱，是因為不能改原始碼；現在可以直接改。
- 因此要把方向從「在外面貼 CSS、在沙箱裡寫插件」改成「**直接改原始碼**，必要時才挑選性合併上游」。
- **要先做 Phase 0**：fork 目前的 updater 和 app identifier 仍指向官方版，直接 build 會跟官方 NoteGen 互相覆蓋。

## 1. 舊前提 → 新前提

| 項目 | 之前（HANDOFF） | 之後（個人 fork） |
|---|---|---|
| 外觀 | 外部 custom CSS v6.16（~700 行，靠 DOM 指紋 selector） | 琥珀主題寫進原始碼的主題變數 / 元件，CSS 檔退役或只留微調 |
| Dialog | 方案 A：CSS-only | 方案 B：直接改元件 |
| 今日儀表板 | 插件 + 宣告式 UI（受 QuickJS、120 RPC/秒、無計時器、無資料通道限制） | 二選一（見決策 D2）：原生頁面，或保留插件但在 host 補 `host.data` 通道 |
| Slash menu 鍵盤 bug | 等隔離測試回報 | 直接在 `slash-command-portal.tsx` / `slash-menu.tsx` 除錯修正 |
| 上游 PR（iframe 資料通道） | 想送 PR 給 codexu | 先在 fork 內實作，送不送上游另議 |
| 檔案位置 | `custom-css/` 未納入 git | 納入版本控制（見 Phase 0） |

**沿用不變**：HANDOFF 第 3 節的設計決策（琥珀 `#fbbd23`、不用紫色、卡片風格、尺寸、字型、B-1 tab）、第 4 節的 vault 事實、第 8 節的工作偏好。

## 2. 已完成（承接自 HANDOFF）

- CSS v6.16，18 個 section，待截圖驗收：插件視圖、檔案列表、todo dialog。
- 插件 NoteGen Today v0.1.0：可載入、可渲染；已移植 CC 的 `parseTaskLine` / `bucketFor` / `parseDailyNote` / `stamp()`、search-first + cache 掃描、兩階段 render。
- 第 7 節的 Obsidian 替代方案研究（結論：Claude Code 掃 Inbox skill 優先）。

## 3. 分階段計畫

### Phase 0 — Fork 基礎建設（先做，約半天）

1. **隔離官方版**
   - `src-tauri/tauri.conf.json`：`identifier` 從 `com.codexu.NoteGen` 改成例如 `tw.scottchen.NoteGen`（資料目錄分開），`productName` 視需要加後綴。
   - `updater.endpoints` 目前指向 `download.notegen.top` / codexu releases → **移除或停用**，否則自動更新會把 fork 換回官方版。
2. **Git 結構**
   - 加 `upstream` remote → `codexu/note-gen`。
   - 分支：`upstream-dev`（純鏡像上游）＋ `dev`（個人主線）；需要時用 merge 或 cherry-pick 把上游合併進來。
   - 把 `custom-css/` 納入 git（或移到 `personal/`），清掉 `.textClipping`、`.DS_Store`。
   - 決定 graft 產生的 `.mcp.json`、`.ignore`、`.gitignore` 修改要不要 commit。
3. **CI**：`.github/workflows/`（`release.yml`、`publish-config.yml`、`plugin-contract.yml`）會用上游的 secrets 和發佈目標 → 停用或改寫成只 build 自己的 macOS 版。
4. **本機 build 驗證**：`pnpm install` → `pnpm tauri dev` 能起來，再試一次 `pnpm tauri build`。

### Phase 1 — 驗收與收尾（承接 HANDOFF 未決項）

1. Scott 用 CSS v6.16 + 插件截圖驗收（插件視圖、檔案列表、todo dialog）。
2. 修 slash menu 鍵盤導航：在原始碼重現 → 找出 keydown listener 衝突或 `%name%` i18n key 未解析的原因 → 修正。

### Phase 2 — 主題原生化

1. 把 CSS v6.16 的變數區（`.dark` 的 HSL、琥珀 primary、shell/card 色、字型）搬進原始碼的全域樣式，做成內建主題（例如「Obsidian Amber」）。
2. 依 section 逐步把 DOM 指紋 selector 改寫成直接改元件的 className（標題列、狀態列、resizable handle、檔案列表、左側欄 B-1 tab、toggle active）。
3. 每搬一段就從 custom CSS 檔刪掉對應 section；最終 custom CSS 歸零或只剩個人微調。
4. Dialog 方案 B：直接改記錄文本 / 連結記錄 / 待辦 / 截圖四個 dialog 元件。
5. 大改動照慣例**先給示意圖**再動手。

### Phase 3 — 今日工作區（依 D2 決策）

- **選項 A：原生頁面（建議）**：直接寫成 React 頁面 / 側欄分頁，用 app 內部的檔案 API 掃 vault，不受 RPC 配額和無計時器的限制；時鐘、timeline「現在」列、即時更新都能做；把 entry.js 的解析邏輯移植成 TS 模組。
- **選項 B：保留插件 + 補 host 通道**：在 `plugin-sandboxed-view.tsx` 增加 `host.data` 訊息，讓 embedded-view iframe 可拿資料，改用 ReUI React 版本（之前擱置的那版）。
- 兩者都補上 HANDOFF 列的後續項：需處理計數納入 Inbox 過期、timeline「現在」列顏色。

### Phase 4 — 上游同步與維護（持續）

- 每 2–4 週 fetch `upstream`，看 changelog，挑選性合併；有衝突時以個人修改為準。
- 改動盡量集中在少數檔案 / 新檔案，降低合併衝突。
- 在 `personal/` 維護一份 `FORK-CHANGES.md`，列出所有偏離上游的修改。

### 平行支線（不依賴 fork）

- Claude Code「掃 `10 Inbox` 整理」skill 的 SKILL.md 草稿（HANDOFF 第 7 節）。定位不變：NoteGen = 收件匣 / AI 整理台 + 語音捕捉；Obsidian = 知識庫。

## 4. 需要 Scott 決定的事

| # | 問題 | 建議 |
|---|---|---|
| D1 | identifier / productName 要改成什麼？要跟官方版並存嗎？ | `tw.scottchen.NoteGen`，名稱「NoteGen (Scott)」，可並存 |
| D2 | 今日工作區：原生頁面 or 插件 + host 通道？ | 原生頁面（限制最少） |
| D3 | 要持續合併上游，還是之後完全分岔？ | 持續挑選性合併 |
| D4 | 要發佈 build（GitHub Release / 自動更新）嗎？還是只在本機 build？ | 先只做本機 build |
| D5 | 只做 macOS 桌面版，還是也維護 mobile（iOS/Android）？ | 只做 macOS |
| D6 | `custom-css/` 改名搬到 `personal/` 並 commit？ | 是 |

## 5. 進度

| 項目 | 狀態 | 備註 |
|---|---|---|
| Phase 0 | ✅ 完成 2026-10-15 | commit `26c82718`、`b62bbb73`；本機 build `NoteGen (Scott).app` 成功（需 stable Rust，見 FORK-CHANGES） |
| Phase 1-2 slash menu 鍵盤 | ✅ fork 版無法重現 2026-10-15 | 隔離測試：乾淨環境、+custom CSS、+NoteGen Today 皆正常。疑似由上游 `a79486cb`（AI 續寫浮窗跨編輯器攔截 Enter/Escape，v0.38.2 之後才修）解決；`%name%` 是其他插件 manifest 的在地化 key 沒有翻譯。再出現時先查舊環境裝的其他插件 |
| Phase 1-1 CSS / 插件截圖驗收 | ⏳ 待 Scott | 原生今日頁完成後 NoteGen Today 插件預計停用，這項可能不再需要 |
| Phase 3 今日工作區（文件 04 的 Phase 1：F1–F3、D1–D8） | ✅ 程式完成 2026-10-18，PR #2、#3 已合併 `dev` | 實機驗收待 Scott，步驟見 FORK-CHANGES「測試步驟」；測試 vault：`node personal/make-test-vault.mjs` |
| Phase 2-1 基本雙鏈（L1 wikilink、L2 自動完成、L3 反向連結） | ✅ 已合併 `dev`（PR #4，2026-10-19 16:14） | 規格 `personal/specs/07-Phase2-1實作規格.md`；共用模組 `src/lib/markdown/wikilink.ts`；三條軌道由 Claude Code（L1）、Codex（索引＋L3）、Grok（L2）分 worktree 開發，PM（Claude）整合；worktree 與分支已清；實機驗收步驟見 FORK-CHANGES「Phase 2-1 基本雙鏈」；後續：存檔路徑還原表格原文（上游序列化器重排）、2-2 補相對路徑解析 |
| Phase 2-2 知識庫整理（L5 屬性面板、L7 改名改寫連結、L6 筆記標籤、L4 未連結提及） | ✅ 已合併 `dev`（PR #5，2026-10-19） | 規格 `personal/specs/08-Phase2-2實作規格.md`；共用模組 `src/lib/note-rewrite.ts`；整合分支 `feat/p2-2-knowledge-base`；三軌：Claude Code（L7＋L4）、Codex（L5）、Grok（L6）在 `../note-gen-wt/{a,b,c}`；三軌已整合，worktree 與分支已清；實機驗收步驟見 FORK-CHANGES「Phase 2-2 知識庫整理」；後續：索引 `#tag` 規則、表格序列化小 PR、2-3 前先答三問 |
| Phase 2-3a 嵌入與跳轉、local graph、索引標題與區塊、表格原文往返 | ✅ 已合併 `dev`（PR #6，2026-10-19） | 規格 `personal/specs/09-Phase2-3a實作規格.md`；整合分支 `feat/p2-3a`；三軌：Claude Code（嵌入／跳轉／表格）、Codex（L8 graph）、Grok（索引＋自動完成）三軌已整合，worktree 與分支已清；驗收步驟見 FORK-CHANGES「Phase 2-3a」；下一步 2-3b（Bases 子集、.canvas、大 vault 效能） |
| Phase 2-3b Bases 子集、.canvas 相容、大 vault 效能 | ✅ 已合併 `dev`（PR #7，2026-10-19） | 規格 `personal/specs/10-Phase2-3b實作規格.md`；整合分支 `feat/p2-3b`；三軌已整合，worktree 與分支已清；驗收步驟見 FORK-CHANGES「Phase 2-3b」；Phase 2 功能完成，進 2-4 試用期 |
| Phase 2-4 試用期 | 🔄 進行中（2026-10-20 起） | Scott 拿 NoteGen 當主力用兩週，依 FORK-CHANGES 各段驗收步驟與日常使用記下缺口，交由 PM 排修；之後決定是否停用桌面版 Obsidian |
| Phase 2-4 屬性卡片：編輯區頂端 frontmatter 卡片、一鍵範本、設定頁範本 | ✅ 已合併 `dev`（PR #24，2026-10-24） | 只改 UI、格式不動；卡片只改節點 attr、不走 `rewriteNote`；`applyFrontmatterEdit` 保留 flow 清單寫法；驗收步驟見 FORK-CHANGES「Phase 2-4 屬性卡片」；codex 額度恢復後補審 |
| Phase 4 上游同步 #1（v0.38.3，39 個 commit） | ✅ 已合併 `dev`（PR #25，2026-10-25） | 10 個衝突已解；上游移除分節大文件、背景 tokenize 在 fork 自動停用；順帶修上游 dev 無法 build 的型別問題；實機回歸待 Scott（見 FORK-CHANGES 同步紀錄） |
| Phase 2 啟動前三問（手機、必要外掛、vault 規模） | ⏳ 待 Scott | 2-1 先採假設：手機續用 Obsidian；2-2 之前要回答 |

## 6. 同意後的第一步

執行 Phase 0 的 1–2（identifier、updater、upstream remote、分支、納入 git），完成後回報再進 Phase 1。
