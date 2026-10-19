---
title: Phase 2-3a 實作規格：嵌入與跳轉、local graph、索引標題與區塊、表格原文往返
filename: 09-Phase2-3a實作規格.md
created: 2026-10-19 18:00 (Asia/Taipei)
modified: 2026-10-19 18:00 (Asia/Taipei)
source_llm: Claude (Fable 5.1, Claude Code session，PM 角色)
status: 派工中（2026-10-19）
---

# Phase 2-3a 實作規格

> 版控正本在 `personal/specs/`，`docs/notegen-plan/09` 只是副本。其他規劃文件在 `docs/notegen-plan/`。

依 [05-Phase2規劃](05-Phase2規劃.md) 的 2-3「Obsidian 功能補齊」。2-3 工時 170～230h，拆成兩段：

- **2-3a（本檔）**：`![[嵌入]]` 內容轉入、`[[Note#標題]]`／`[[Note#^id]]` 跳轉捲動、L8 local graph、索引補標題與區塊 id 並修 `#tag` 規則、L2 自動完成補 `#` 與 `^`、表格原文往返。
- **2-3b（之後）**：Bases 子集（取代 Dataview 查詢）、`.canvas` 相容、大 vault 效能。

**硬性驗收不變：存檔後沒動到的內容一字不差。** 本階段多一條：**表格也一字不差**（解掉 2-1 以來的上游重排問題）。

## 0. 前提與假設

三個啟動前問題 Scott 指示採預設：手機續用 Obsidian（所有寫入維持 Obsidian 相容）；必要外掛 Tasks、Dataview、Templater（所以 2-3b 先做 Bases 子集取代 Dataview；本段不受影響）；vault ≤ 3,000 篇（graph 深度 2 以內直接算，不做增量）。

既有基礎：Phase 2-1（PR #4）與 2-2（PR #5）已合併 `dev`。索引 `INDEX_SCHEMA_VERSION = 2`，`IndexedNote { path, mtime, frontmatter, tasks, links, aliases, tags }`。共用模組：`src/lib/markdown/wikilink.ts`、`src/lib/note-rewrite.ts`、`src/lib/vault-index/links.ts`、`src/lib/daily/note-io.ts`。

## 1. 分工與擁有權

| 軌道 | 功能 | 執行者 | 可改的檔案 |
|---|---|---|---|
| **A** | `![[嵌入]]` 轉入、`#標題`／`^id` 跳轉捲動、表格原文往返 | Claude Code（子代理） | fork 檔 `src/app/core/main/editor/markdown/wikilink-extension.ts`、`markdown/style.css`、`tests/l1-wikilink-roundtrip.test.ts`；新檔 `src/app/core/main/editor/markdown/wikilink-embed-view.tsx`、`src/lib/markdown/note-section.ts`（＋測試）、`src/app/core/main/editor/markdown/table-raw-extension.ts`（＋測試 `tests/table-roundtrip.test.ts`）；掛載點 `tiptap-editor.tsx`（只准改 `MarkdownTable` 那一行與必要的 import） |
| **B** | L8 local graph | Codex | 新檔 `src/lib/vault-index/graph.ts`（＋測試）、`src/app/core/main/graph/`（新資料夾）；掛載點 `src/components/plugins/plugin-right-sidebar.tsx`（加一個 tab）；6 個語系檔：頂層 `localGraph`（插在 `properties` 之後、`settings` 之前） |
| **C** | 索引補 `headings`／`blockIds`、`#tag` 規則修正、L2 自動完成 `#`／`^` | Grok | fork 檔 `src/lib/vault-index/index-note.ts`、`vault-index.test.ts`、`src/lib/wikilink-suggest-model.ts`（＋測試）、`src/app/core/main/editor/markdown/wikilink-suggest.tsx`；6 個語系檔 `editor.wikilinkSuggest` 內加 key |

共通規則（同 2-1、2-2）：不改 `package.json`／lockfile、不 `pnpm install`、不 commit、不 push、不改 `personal/FORK-CHANGES.md`；上游檔案只加掛載點並回報行號；vitest 全部通過（目前 36 檔 455 項）且 `npx tsc --noEmit` 無錯；i18n 六語系；繁中為主；Tailwind／shadcn、琥珀強調色；不用 MCP 工具。

軌道之間沒有相依：A 的嵌入與跳轉自己解析目標檔案的標題與區塊（`note-section.ts`），不等 C 的索引；C 的自動完成用索引的新欄位；B 只讀索引既有的 `links`。

## 2. 軌道 A

### A-1 `![[嵌入]]` 內容轉入

行為（照 Obsidian）：

1. `![[Note]]`：在原位置顯示目標筆記的內容（去掉 frontmatter），唯讀，上方一行小字顯示筆記名稱（可點開啟），最高 `24rem` 超過可捲。`![[Note#標題]]` 只顯示該標題到下一個同級或更高級標題之前的段落；`![[Note#^id]]` 只顯示帶 `^id` 的那一段（段落、清單項或表格列）。
2. `![[圖.png]]`、`![[圖.png|300]]`（寬度）：顯示圖片，路徑用上游 `src/lib/markdown-image-path.ts` 的解析（看 `resolveImagePathFromMarkdown` 怎麼把相對路徑變成可顯示的 URL）；其他附件（pdf 等）顯示檔名與「開啟」。
3. 目標不存在：顯示「找不到 ⧉ 名稱」虛線框（沿用 2-1 樣式）。
4. 嵌入內容用專案既有的 markdown 預覽方式渲染；若找不到可重用的元件，用 `marked` 轉 HTML 並 sanitize（`dompurify` 若不在依賴就自己做最小白名單），**不要**再開一個 Tiptap 實例。嵌入內的 `[[連結]]` 顯示為可點文字。
5. 內容來源 `readNote`（`src/lib/daily/note-io.ts`），依目標路徑快取；目標檔案由 watcher 更新索引 `revision` 時重讀。遞迴嵌入最多 2 層，第 3 層顯示「⧉ 名稱」不轉入。
6. 存檔仍是 `attrs.raw` 一字不差（既有往返測試不能壞）。

實作：`wikilink-extension.ts` 的 `renderHTML` 對 `embed: true` 改走 `addNodeView`（React node view，`@tiptap/react` 的 `ReactNodeViewRenderer`，參考同資料夾 `math-extension.tsx` 或 `code-block-view.tsx` 的做法），元件在新檔 `wikilink-embed-view.tsx`。純函式 `src/lib/markdown/note-section.ts`：`extractSection(content, heading)`、`extractBlock(content, blockId)`、`stripFrontmatter(content)`，含測試（標題不分大小寫、`#` 層級、區塊 id 在行尾 `^id`、表格與清單項的區塊）。

### A-2 `#標題`／`^id` 跳轉捲動

1. 點 `[[Note#標題]]`：開啟 Note 後捲到該標題；點 `[[#標題]]`：本篇捲動（2-1 是不動作）。`[[Note#^id]]`：捲到含 `^id` 的段落並短暫高亮（1.5 秒 `bg-primary/10`）。
2. 實作：`openWikilink` 開檔後等編輯器載入完成（監聽 `emitter` 的 `editor:ready` 或輪詢 `activeFilePath` 變更後的下一個 tick），再在 `editor.state.doc` 找 heading 節點（文字比對不分大小寫、去頭尾空白）或含 `^id` 文字的段落，`editor.view.nodeDOM(pos).scrollIntoView({ block: 'start' })`，參考 `outline.tsx` 約 966～990 行的 `scrollToHeading`。找不到就只開檔。
3. 編輯器實例的取得方式：看 `tiptap-editor.tsx` 怎麼把 `editor` 交給大綱（`onEditorReady`），若沒有全域可拿的實例，就在 `wikilink-extension.ts` 的 plugin view 裡記住 `view`（同一個檔案只有一個編輯器）。

### A-3 表格原文往返

問題：上游 `@tiptap/markdown` 把 `|---|---|` 補成 `| --- | --- |`、儲存格補空白、表前多一個空行。

做法：新檔 `table-raw-extension.ts` 匯出 `withRawTableRoundtrip(TableExtension)`（或等價的 `Extension`）：

1. `parseMarkdown` 時把 `token.raw`（原始表格文字，含結尾換行狀態）存進 table 節點的 `rawMarkdown` 屬性，另存 `rawSignature`＝每格文字 trim 後以 `\u0001` 連接的簽章（含表頭列）；屬性不輸出到 HTML（`rendered: false`）。
2. `renderMarkdown` 時重新計算簽章：相同 → 輸出 `rawMarkdown`（去掉尾端多餘換行，讓序列化器自己接空行）；不同（使用者改了表格）→ 走原本的 `renderTableToMarkdown`。
3. 表前多一個空行的問題要查清楚是序列化器在 table 前固定加 `\n` 還是段落結尾的問題，用測試鎖定：`"text\n\n| a |\n|---|\n| 1 |\n"` 往返後一字不差。
4. 掛載：`tiptap-editor.tsx` 第 1299 行附近 `const MarkdownTable = Table.extend({...})` 改成套用本擴充後再 extend（保留上游的 `promoteFirstTableRowInMarkdown`），只動那一處與 import。
5. 與 2-1 的 `WikilinkTable` block tokenizer 相容：它回傳的 token 也有 `raw`，一樣要存。
6. 測試 `tests/table-roundtrip.test.ts`（harness 照 `tests/l1-wikilink-roundtrip.test.ts`，extensions 要含 `MarkdownTable` 的等價物、`Wikilink`）：緊湊表格、對齊列 `|:--|--:|`、含 `\|` 的 wikilink 表格、表格前後文字、CRLF、改了一格後正常輸出、`60 Notes/雙鏈表格.md` 樣本一字不差。

## 3. 軌道 B：L8 local graph

### 行為

1. 右側欄新 tab「關聯圖」（`@graph`，lucide `Waypoints`），放在「屬性」之後。
2. 以目前開著的筆記為中心：深度 1 ＝ 連到它的＋它連出去的（已解析）；深度 2 再往外一層。切換按鈕「1 層／2 層」，預設 1。未解析的連出目標畫成虛線節點（淡色），不再往外展開。
3. 節點顯示 `noteKeyOf(path)`；中心節點琥珀色實心；同資料夾以淡色外框區分（不用顏色編碼資料夾）。邊：有向，反向連結指向中心。
4. 點節點 → `revealInFileTree` ＋ `setActiveFilePath`（圖會換中心）；hover 顯示完整路徑。
5. 佈局用 `elkjs`（已在依賴，`layered` 或 `stress`）算座標，畫圖用 `@xyflow/react`（參考 `src/app/core/main/canvas/canvas-editor.tsx` 的 import 與基本設定；只用唯讀模式：不可拖建邊、不可刪）。節點超過 150 個時顯示「節點太多，請切回 1 層」並只畫前 150（依與中心距離、再依路徑排序）。
6. 索引 `status !== 'ready'` 顯示「索引中…」；非 `.md` 顯示提示；沒有任何連結顯示「這篇還沒有連結」。
7. 索引 `revision` 變了重算（用 `useMemo` 依 revision＋path＋depth）。

### 純函式（新檔 `src/lib/vault-index/graph.ts` ＋ `graph.test.ts`）

- `buildLocalGraph(centerPath, notes: Iterable<IndexedNote>, { depth: 1 | 2, limit = 150 })` → `{ nodes: GraphNode[], edges: GraphEdge[], truncated: boolean }`，`GraphNode = { id: path 或 'unresolved:目標', label, path: string | null, distance, folder }`，`GraphEdge = { source, target }`；用 `resolveIndexedLink`（`links.ts`）解析；去重、排序穩定；自連不畫。
- `layoutLocalGraph(graph)`：呼叫 elk，回 `Map<id, { x, y }>`；測試用假 elk（注入 `layout` 函式參數）。

### UI 與掛載

- `src/app/core/main/graph/local-graph-panel.tsx`（＋ `local-graph-panel.test.ts` 測純邏輯：節點樣式對應、截斷訊息）。
- `plugin-right-sidebar.tsx`：照 `@properties` 的三處改法再加 `@graph`；回報行號。
- i18n 頂層 `localGraph`：`title`（關聯圖）、`depth1`（1 層）、`depth2`（2 層）、`empty`（這篇還沒有連結）、`indexing`、`notMarkdown`、`unresolved`（尚未建立）、`truncated`（節點太多，只顯示前 {count} 個）。

## 4. 軌道 C：索引標題／區塊、`#tag` 規則、自動完成 `#`／`^`

### C-1 索引（`src/lib/vault-index/index-note.ts`）

- `IndexedNote` 加 `headings: Array<{ level: 1|2|3|4|5|6, text: string, line: number }>`（ATX 標題，去掉尾端 `#`，跳過 code 與 frontmatter）與 `blockIds: Array<{ id: string, line: number }>`（行尾 ` ^id`，`id` 允許 `[A-Za-z0-9-]`；表格列與清單項也算）。
- `#tag` 規則修正：前導字元允許行首、空白、`(`、`（`，**另加全形標點 `，`、`、`、`；`、`：`、`。`**（Obsidian 認得緊接 CJK 標點後的標籤）；**純數字**（`#12`）與純數字加 `/`（`#2026/10`）不算標籤（Obsidian 規則：至少一個非數字字元）。
- `INDEX_SCHEMA_VERSION` 改 `3`。`vault-index.test.ts` 補案例並更新預期。
- `index-core.ts`／`service.ts` 不用動（欄位序列化是整個物件）。

### C-2 自動完成（`src/lib/wikilink-suggest-model.ts`、`wikilink-suggest.tsx`）

- `findWikilinkInputContext` 回傳多一個欄位 `mode: 'note' | 'heading' | 'block'` 與 `noteQuery`：游標前 `[[` 到游標之間若有 `#` → `heading` 模式（`#` 前是筆記名或空＝本篇），`#^` → `block` 模式；`query` 是 `#` 或 `#^` 之後的文字。
- `rankHeadingSuggestions({ noteQuery, query, notes, currentPath })`：先用既有 `rankWikilinkSuggestions` 的規則對到唯一筆記（或本篇），列它的 `headings`（前綴 > 子序列），顯示層級縮排；`rankBlockSuggestions` 同理列 `blockIds`（顯示 id 與那一行的前 60 字，需要 `line` 對應的文字 → 索引 `blockIds` 多存 `context: string`）。
- `buildWikilinkInsertion` 支援 heading／block：輸出 `[[Note#標題]]`、`[[Note#^id]]`、`[[#標題]]`（本篇）；`hasClosingBrackets` 規則不變。
- 元件：選單依 `mode` 切資料源；heading 模式沒有「建立」列；輸入 `#` 時立即切換。
- i18n `editor.wikilinkSuggest` 加 `headings`（標題）、`blocks`（區塊）、`noHeadings`（這篇沒有標題）、`noBlocks`（這篇沒有區塊 id）。
- 測試：`wikilink-suggest-model.test.ts` 補 context 判斷、heading／block 排序、插入字串、本篇 `[[#`。

## 5. 整合（PM）

1. 合併順序：C（索引版本 3）→ B（graph）→ A（編輯器），每步跑全部測試。
2. `personal/FORK-CHANGES.md` 修改清單＋驗收步驟；`personal/make-test-vault.mjs` 加 2-3a 樣本（嵌入來源與目標含標題與 `^id`、圖片附件、graph 用的三層連結、`#tag` 規則樣本）。
3. 2-1 FORK-CHANGES 的「表格存檔會被重排」與「部分路徑不解析」已知限制改為已解。
4. 開 PR 到 `dev`：「Phase 2-3a 嵌入與跳轉、local graph、索引標題與區塊、表格原文往返」。

## 6. 不在本階段

Bases、`.canvas`、大 vault 效能（2-3b）；全域 graph；嵌入內容的就地編輯；標籤改名；Properties 的 Visible／Hidden；L7「記住選擇」。
