---
title: NoteGen 客製化專案 Handoff
filename: HANDOFF.md
created: 2026-10-14 23:15 (Asia/Taipei)
modified: 2026-10-15 05:30 (Asia/Taipei)
source_llm: Claude (Fable 5.1, claude.ai session)
status: active
---

# NoteGen 客製化專案 Handoff

> 給下一個 session / LLM 的交接文件。讀完這份就能接手，不需要翻舊對話。

## 1. 專案目標

- 讓 **NoteGen**（codexu/note-gen，Tauri 2 + Next.js）外觀貼近 **Obsidian baseline dark theme**，純 custom CSS 達成。
- 建一個 NoteGen 插件 **NoteGen Today**，複製 Scott 自己 Obsidian 插件 **Command Center v2** 的「今日」工作區（MVP：今日工作區 + Daily Note 面板 + 3 個動作鍵）。
- 定位結論：**NoteGen = 收件匣 / AI 整理台；Obsidian = 知識庫**（NoteGen 無筆記標籤、無 wikilink、無反向連結）。

## 2. 路徑

| 項目 | 路徑 |
|---|---|
| NoteGen 原始碼 clone | `/Users/scottchen/Documents/20_Projects/note-gen/` |
| 本專案工作目錄 | `…/note-gen/personal/` |
| 主 CSS | `personal/notegen-obsidian-baseline.css`（**v6.16**，~700 行） |
| 插件 | `personal/plugin-skeleton/notegen-today/`（plugin.json / entry.js / integrity.json / make-integrity.sh / README.md） |
| 試算表 | `personal/NoteGen 自訂 CSS 對照表.xlsx`、`personal/NoteGen Dashboard 功能保留對照.xlsx` |
| 示意圖 | `personal/notegen-dashboard-mvp*.png/html`、`notegen-today-mvp.*`、`notegen-today-reui.png` |
| Command Center v2 原始碼 | `/Users/scottchen/Documents/20_Projects/command-center_v2/`（`taskScan.ts`、`taskLine.ts`、`cockpit/dailyNote.ts`、`dailyOps.ts`、`paths.ts`、`DESIGN.md`、`PRODUCT.md`） |
| Obsidian vault（NoteGen workspace 已指向此） | S.2ndBrain |

## 3. 設計決策（已定案，不要重開）

- **色系：琥珀 `#fbbd23`，不用紫色**。primary `43 96% 56%`，primary-foreground `0 0% 9.8%`。
- 外殼 `#161616`、卡片 `#202020`、卡片間距 14px、無分隔線（card 風格）。
- 標題列 44px、狀態列 30px。
- 左側欄 header 採 **B-1：文字 tab + 底線**（筆記 / 記錄 / 畫布，CSS `::after` 注入）。
- 檔案列表仿 Obsidian / VS Code：26px 行高、13px 字、隱藏圖示、縮排導線。
- 編輯區 **不覆寫 max-width / line-height**（由 app 設定控制，v6.11 起）。
- 字型 `"Inter", …, "PingFang TC"`，透過 `--notegen-app-font-family !important`。
- Dialog（記錄文本 / 連結記錄 / 待辦 / 截圖）先走 **CSS-only（方案 A）**；方案 B 改原始碼尚未做。
- 插件 dashboard 走 **宣告式 UI（方案 1）**；ReUI React 版本因 iframe 無資料通道而擱置。

## 4. NoteGen 技術事實（花很多時間才確認，務必沿用）

### CSS 注入
- Custom CSS 以 `<style id="notegen-custom-css">` 注入，MutationObserver 保持在最後 → 永遠勝出。
- 所有顏色走 `hsl(var(--x))` → 覆寫 `.dark` 的 HSL 變數即可；theme JSON 已無必要。
- 變數一定要加 fallback `var(--x, fallback)`，否則貼不完整整個 UI 會壞。
- 關鍵 DOM 指紋：標題列 `div.fixed.top-0[data-tauri-drag-region]`；狀態列 `footer.h-6`；面板 `data-slot="resizable-panel-group|resizable-panel|resizable-handle"`（handle 需設 `width/flex: 0 0 var(--ob-card-gap)`）；編輯器 `.tiptap-editor .ProseMirror`；dialog `[data-slot="dialog-content"]`；插件視圖 `main div[aria-busy] > div.flex.min-w-0.flex-col.break-words`。
- shadcn toggle active = `data-[state=on]:bg-muted`，當 `--muted == card` 會看不見 → section 16 已補。
- Slash menu 鍵盤導航是 document keydown listener（`slash-command-portal.tsx:222`、`slash-menu.tsx:281-298`），**CSS 影響不到**。

### 插件系統
- manifest 檔名 **`plugin.json`**；需 **`integrity.json`**（`{version:1, algorithm:"sha256", files:[{path,size,sha256}]}`）；`signature.sig` 選填。
- entry 必須是單檔 ESM `.js`、`export activate(ctx)` / `deactivate`、**不能 import 任何模組**。
- `apiVersion: "^0.1.0"`（PLUGIN_API_VERSION 0.1.9）。
- activationEvents 只接受 `onEditor:markdown`、`onWorkspace:open`、`onNotes:change`、`onCommand:<已宣告 id>`。
- 權限 scope：`notes.list/open/create/move` → `workspace-folder`；`notes.read/write` → `workspace-folder`（要整個 vault 就用這個）；`records.read / ai.generate / chat.* / clipboard.write` → `application`。
- settings 需 plugin-id 前綴 key + scope + type；statusBar 需 `alignment`；icon 只能 `[A-Za-z0-9-]`。
- 執行環境 QuickJS worker：**無 setTimeout / setInterval**；**120 RPC/秒** 上限（QuotaExceeded）；`notes.list` 回 `{entries:[{path,name,size,modifiedAt?}], nextCursor}` limit≤1000；`notes.search({query, limit≤100})`；`storage.workspace.get/set`；`ui.views.update(id,{blocks})`；**無 settings.set、無 mcp.\***。
- 宣告式 block 可用：heading、text(tone)、key-value、table(rows 可帶 command)、actions、callout、separator、progress、list、tree、navigation-list。**layout / section / badge 會觸發 "Plugin UI content is malformed"**。
- Embedded-view iframe 只有 `host.theme / host.settings` 訊息，**沒有資料通道**，且不能放在 editor-tab / sidebar → 主視圖只能用宣告式 UI。

### Vault 事實（來自 CC）
- dailyDir `20 Journal/21 Daily`，檔名 `YYYYMMDD`，inbox `10 Inbox`。
- NOT_TASK_PREFIXES = `00 System/07 dev/`, `temp/`, `copilot/`, `plans/`, `openspec/`, `10 Inbox/`, `00.Inbox/`, `inbox/`, `00 System/05 templates/`。
- 標記 `morning:: done` / `reviewed:: done`。

## 5. 目前狀態

### CSS v6.16（已交付，待 Scott 截圖驗收）
- 18 個 section 全部完成（變數、字型、標題列、狀態列、卡片面板、icon 按鈕、chat 輸入框、Tiptap 排版、slash menu、控制元件、focus、按鈕配色、左側欄 B-1、dialogs、截圖畫面、todo dialog、toggle、檔案列表、插件視圖 + 三張表格樣式）。
- 待驗收項目：插件視圖樣式、檔案列表、todo dialog。

### 插件 NoteGen Today（可載入、可渲染，待驗收）
- 已移植 CC 正式邏輯：`parseTaskLine`（due:: / 📅）、`bucketFor`、`parseDailyNote`、`stamp()`。
- `scanTasks`：`notes.search('- [ ]')` 候選 ∪ cache，只重讀 modifiedAt 變動者，每輪最多 40 次讀取，cache key `today.scan.v1`。
- 無計時器：`rendering/dirty/lastRenderAt` 節流 + 兩階段 render（先畫框再掃描）。
- 畫面 blocks：時鐘 → 需處理 → attention 表 → 今日錨點 timeline 表 → Daily Note key-value → 本週 7 欄表 → actions（早晨啟動 / 整日復盤 / 開啟 Daily Note / 重新掃描）。
- **改完 entry.js 一定要跑 `bash make-integrity.sh`** 再重新匯入。

### 未解決 / 待 Scott 回覆
- Slash menu 鍵盤無法操作：需 NoteGen 版本號 + 關閉 CSS / 插件後的隔離測試結果（看到未解析 i18n key `%name%`，疑似 app 本身問題）。
- 可選後續：上游 PR 加 iframe `host.data` 通道；dialog 方案 B 改原始碼；需處理計數納入 Inbox 過期；timeline「現在」列顏色（需資料通道）。

## 6. 踩過的坑（別再踩）

| 症狀 | 原因 / 解法 |
|---|---|
| 整個 UI 壞掉 | 貼了部分 CSS 沒帶變數區塊 → 全部 `var(--x, fallback)` |
| 編輯器出現紫色直線 | `*:focus-visible` 打到 ProseMirror → 排除編輯器與 input |
| 快速開始卡片變白 | `.rounded-lg.border.bg-primary-foreground` 需改成 card 色 |
| 三欄黏在一起 | handle 沒設寬度 → `width/flex: 0 0 var(--ob-card-gap)` |
| 內容寬度設定無效 | CSS 覆寫了 max-width → 移除 |
| 檔案列表圖示藏不掉 | selector 層級錯 → `.relative.flex.min-w-0.flex-1 > svg, > div.shrink-0` |
| 插件 CSS 沒套上 | 改用 `div[aria-busy]` 指紋 |
| 插件匯入連環錯誤 | 依序：缺 integrity.json → manifest.json 要叫 plugin.json → apiVersion ^0.1.0 → entry 不能 import → activationEvents 白名單 → scope workspace-folder → workspace 要先指向 vault → QuotaExceeded 改 search-first+cache → 拿掉 layout/section/badge → 拿掉 setInterval → 兩階段 render |
| 裝置端 shell 是 Linux | 用 `sed -i`（非 `-i ''`）、`wc -c`（非 `stat -f%z`）；連結資料夾不能 `rm` → 搬到 `_to_delete/` |

## 7. Obsidian 替代方案研究結論（2026-10-14）

- 問題：Obsidian 有沒有插件能取代 NoteGen 的「收件匣 + AI 整理台」？
- 結論：**沒有單一插件完整取代；Note Companion 最接近**。
- 比較摘要：
  - **Note Companion**：唯一做「inbox 自動命名/歸檔/標籤」；MIT、可自架（Docker）；雲端 $15/月；BYO key 只有自架才能用；桌面限定。
  - **Smart Composer**：免費 MIT、Cursor 式 diff 套用、Ollama 可離線、支援 MCP；**作者標示不再積極開發**。
  - **SystemSculpt**：功能最廣（agent / Studio 工作流 / 轉錄），但閉源、必須走其雲端 credit（$19/月或 $149 買斷），隱私成本最高；**不建議**。
  - 其他值得看：**Copilot for Obsidian Plus**（最成熟 agent）、**AI Tagger Universe**（批次標籤）、**Smart Connections**（關聯發現）、**Claude Code + vault 寫整理 skill**（零成本、規則可寫進 CLAUDE.md，優先試）。
- 建議組合：Claude Code skill 掃 `10 Inbox`（主）＋ Smart Composer 或 Copilot 免費版（編輯）＋ Obsidian Web Clipper（連結）；語音捕捉仍是 NoteGen 的留存理由。
- 可能的下一步：撰寫「Claude Code 掃 Inbox 整理 skill」SKILL.md 草稿。

## 8. Scott 的工作偏好（接手者必讀）

- 繁體中文；Markdown 標題 + 條列；簡潔、先講結論。
- 交付檔案要標 filename / created / modified / source LLM。
- 試算表用 xlsx。**不要紫色**。
- 改 CSS 時給「整段更新好的內容」，不要只給片段。
- 大改之前先給示意圖，確認後再做。
- 自動化建議對齊 Claude Code / Paperclip，不假設 n8n 或 cron。

## 9. 下一個 session 的起手式

1. 讀本檔 + `personal/plugin-skeleton/notegen-today/README.md`（插件）+ 兩份 xlsx。
2. 問 Scott：CSS v6.16 與插件渲染的截圖驗收結果；slash menu 隔離測試結果 + 版本號。
3. 依回饋修 CSS（記得版本號 +1、更新檔頭 modified）或修 entry.js（記得 `bash make-integrity.sh`）。
4. 若 Scott 要做 Inbox 整理 skill，從第 7 節的建議組合開始。
