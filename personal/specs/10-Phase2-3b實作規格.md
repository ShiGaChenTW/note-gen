---
title: Phase 2-3b 實作規格：Bases 子集、.canvas 相容、大 vault 效能
filename: 10-Phase2-3b實作規格.md
created: 2026-10-19 19:40 (Asia/Taipei)
modified: 2026-10-19 19:40 (Asia/Taipei)
source_llm: Claude (Fable 5.1, Claude Code session，PM 角色)
status: 派工中（2026-10-19）
---

# Phase 2-3b 實作規格

> 版控正本在 `personal/specs/`，`docs/notegen-plan/10` 只是副本。其他規劃文件在 `docs/notegen-plan/`。

[05-Phase2規劃](05-Phase2規劃.md) 2-3 的後半，接在 [09-Phase2-3a](09-Phase2-3a實作規格.md) 之後。做完這段，Phase 2 的功能清單就齊了，之後進 2-4 試用期。

**硬性驗收不變：寫回 vault 的檔案沒動到的內容一字不差。** 本段新增兩種會寫回的檔案類型：`.canvas`（軌道 B）。`.base` 本段只讀不寫。

## 0. 前提與假設

三問採預設：手機續用 Obsidian（`.base`、`.canvas` 都要照官方格式，Obsidian 開同一檔不能壞）；必要外掛 Tasks、Dataview、Templater（**Bases 子集的目標是取代 Scott 的 Dataview 查詢**，所以先做 table／list、filter、sort，formula 只做最小集）；vault ≤ 3,000 篇（效能目標以 3,000 篇為基準，10,000 篇仍可用）。

### PM 已完成的共用掛載點（整合分支 `feat/p2-3b` 起點）

- `src/stores/article.ts` 第 4104 行：檔案樹過濾改為 `/\.(?:md|base|canvas)$/i`，`.base` 與 `.canvas` 會出現在檔案樹，點擊以路徑開分頁。
- `src/app/core/main/editor/editor-layout.tsx`：`getItemType` 多回傳 `'base' | 'canvas'`；分頁內容對應 `<BasesPage filePath isActive />` 與 `<ObsidianCanvasPage filePath isActive />`。
- 佔位元件 `src/app/core/main/bases/bases-page.tsx`（軌道 A 替換）、`src/app/core/main/obsidian-canvas/obsidian-canvas-page.tsx`（軌道 B 替換）。**元件的 export 與 props 名稱不能改**（`default export`，`{ filePath: string; isActive?: boolean }`）。

既有可用模組：索引 `IndexedNote { path, mtime, frontmatter, tasks, links, aliases, tags, headings, blockIds }`（版本 3）、`src/lib/note-rewrite.ts`（`rewriteNote`）、`src/lib/daily/note-io.ts`（`readNote`／`writeNote`／`noteExists`／`revealInFileTree`）、`src/lib/markdown/wikilink.ts`、`src/lib/vault-index/links.ts`、`yaml`（v2）、`markdown-it`、`@xyflow/react`、`elkjs`。

## 1. 分工與擁有權

| 軌道 | 功能 | 執行者 | 可改的檔案 |
|---|---|---|---|
| **A** | Bases 子集 | Claude Code（子代理） | 新資料夾 `src/lib/bases/`（＋測試）、`src/app/core/main/bases/`（取代佔位，可加檔）、新檔 `src/app/core/main/editor/markdown/bases-block-extension.tsx`；掛載點 `tiptap-editor.tsx`（只准加 1 行 import 與 extensions 1 行，放在 `Wikilink,` 之後）；6 個語系檔：頂層 `bases`（插在 `localGraph` 之後、`settings` 之前） |
| **B** | `.canvas`（JSON Canvas）相容 | Codex | 新資料夾 `src/lib/obsidian-canvas/`（＋測試）、`src/app/core/main/obsidian-canvas/`（取代佔位，可加檔）；6 個語系檔：頂層 `obsidianCanvas`（插在頂層 `canvas` 之後） |
| **C** | 大 vault 效能 | Grok | `src/lib/vault-index/service.ts`、`index-core.ts`、`links.ts`、`tags.ts`、`graph.ts`、`unlinked-mentions-scan.ts`、`src/stores/vault-index.ts`、`src/lib/wikilink-suggest-model.ts`、`src/lib/markdown/unlinked-mentions.ts`（只准做不改行為的效能修改，既有測試一項都不能改預期）；新檔 `tests/perf/vault-perf.test.ts`、`tests/perf/synthetic-vault.ts`；`personal/make-test-vault.mjs` 只准新增 `--big N` 選項那一段 |

共通規則同 2-1～2-3a：不改 `package.json`／lockfile、不 `pnpm install`、不 commit、不 push、不改 `personal/FORK-CHANGES.md`；上游檔案只加掛載點並回報行號；vitest 全部通過（目前 42 檔 560 項）且 `npx tsc --noEmit` 無錯；**i18n 六語系各自真的翻譯**（zh-TW 繁中、en、zh 簡中、ja、de、pt-BR）；Tailwind／shadcn、琥珀強調色；不用 MCP 工具；headless 下被拒的指令換工具不要停。

三軌沒有相依：A、B 各自的資料夾與語系位置不重疊；C 只動效能不動介面。

## 2. 軌道 A：Bases 子集

### 範圍（Obsidian Bases 1.9 的子集）

支援的 `.base` YAML：

```yaml
filters:                 # 全域；and / or / not 可巢狀；字串是運算式
  and:
    - file.hasTag("project")
    - 'status != "done"'
formulas:                # 最小集，見下
  days_left: 'if(due, (date(due) - today()).days, "")'
properties:              # 只用 displayName
  note.status: { displayName: 狀態 }
  formula.days_left: { displayName: 剩餘天數 }
views:
  - type: table          # 支援 table、list；其他型別顯示「不支援」並退回 table
    name: 進行中
    filters: { and: [ 'priority == "high"' ] }   # 與全域 filters 取交集
    order: [file.name, status, due, formula.days_left]   # 欄位順序；list 用第一個當顯示文字
    sort: [{ property: due, direction: ASC }, { property: file.name, direction: DESC }]
    limit: 50
```

運算式語言（純函式 `src/lib/bases/expr.ts`，自己寫 tokenizer＋遞迴下降 parser，不引入套件）：

- 值：字串（單雙引號）、數字、`true`／`false`／`null`、清單 `[a, b]`、日期由 `date("2026-10-19")`／`today()`／`now()` 產生。
- 屬性：`file.name`、`file.basename`、`file.path`、`file.folder`、`file.ext`、`file.mtime`、`file.ctime`（沒有就用 mtime）、`file.tags`（清單，含巢狀父層）、`file.links`（連出，解析後路徑清單）、`file.backlinks`（連入）、`file.size`（沒有就 0）；`note.xxx` 或裸 `xxx`（frontmatter 屬性；`tags`／`aliases` 正規化成清單）；`formula.xxx`（同一檔的 formulas，禁止循環）。
- 運算子：`== != < > <= >= && || ! + - * /`、括號、`.` 成員呼叫。
- 函式（最小集）：`if(cond, a, b)`、`date(x)`、`today()`、`now()`、`number(x)`、`string(x)`、`lower(x)`、`upper(x)`、`contains(list_or_string, x)`、`startsWith(s, p)`、`endsWith(s, p)`、`length(x)`、`join(list, sep)`、`min(a, b)`、`max(a, b)`、`round(x, n?)`；方法寫法 `x.contains(y)`、`x.startsWith()`、`x.lower()`、`list.length`、`file.hasTag("a", "b")`（任一）、`file.inFolder("f")`（含子資料夾）、`file.hasLink("Note")`、`file.hasProperty("key")`；日期相減得 `{ days, hours }` 物件，`.days` 取整數天。
- 型別錯誤或未支援的函式 → 該列該格顯示「⚠ 運算式錯誤：…」，不讓整個 view 失敗。

評估（`src/lib/bases/evaluate.ts`）：輸入 `{ base, notes: Iterable<IndexedNote>, resolve(link) }`，輸出每個 view 的 `{ columns: [{ key, label }], rows: [{ path, cells: Record<key, Value> }], total, truncated, errors }`。排序：數字／日期／字串各自比較，`null` 最後；`limit` 預設 200。

### 介面

1. **`.base` 檔整頁**（`bases-page.tsx` 取代佔位）：上方 view 切換（tab 或下拉），table 表頭可點排序（覆蓋 `sort`，不寫回檔案），`file.name` 欄顯示為連結（點開筆記），日期格式 `YYYY-MM-DD`，清單以 chip 顯示，布林 ✓／空白；list view 是項目清單（顯示 `order` 第一欄＋其餘欄位淡色）；超過 `limit` 顯示「還有 N 筆」。右上角「重新整理」與「原始碼」（唯讀 textarea，顯示 YAML；本段不寫回）。YAML 解析失敗顯示錯誤與行號。索引 `revision` 變動即時重算（`useMemo`）。
2. **筆記內的 ```` ```base ```` 區塊**（`bases-block-extension.tsx`，照 `mermaid-extension.tsx` 的 tokenizer／node view／`renderMarkdown` 寫法）：區塊內容是同樣的 YAML（可省略 `views`，省略時當作單一 table），直接在筆記裡渲染結果；雙擊或「編輯」切回 textarea；存檔輸出原文一字不差（`renderMarkdown` 用節點 attr 的原始字串）。
3. i18n 頂層 `bases`：`title`、`views`、`refresh`、`source`、`unsupportedView`（不支援的檢視類型 {type}，以表格顯示）、`more`（還有 {count} 筆）、`empty`（沒有符合的筆記）、`parseError`（Bases 格式錯誤：{message}）、`exprError`、`indexing`、`edit`、`done`。

### 測試

`src/lib/bases/*.test.ts`：tokenizer／parser 每種節點；filters and/or/not 巢狀；`file.*` 每個屬性；frontmatter 型別（字串、數字、布林、日期、清單、`"[[連結]]"`）；formulas 含循環偵測；sort 多鍵與 `null`；limit；錯誤不中斷。`tests/bases-block-roundtrip.test.ts`：```` ```base ```` 區塊往返一字不差（harness 照 `tests/table-roundtrip.test.ts`）。頁面與區塊元件的純邏輯（view 切換、排序覆蓋）各一個 jsdom 測試。

## 3. 軌道 B：`.canvas`（JSON Canvas 1.0）相容

### 格式（`src/lib/obsidian-canvas/format.ts` ＋測試）

- 依 JSON Canvas 1.0 規格（https://jsoncanvas.org/spec/1.0/）：`nodes[]`（共用 `id, type, x, y, width, height, color?`；`type: text` 有 `text`；`file` 有 `file, subpath?`；`link` 有 `url`；`group` 有 `label?, background?, backgroundStyle?`）、`edges[]`（`id, fromNode, fromSide?, fromEnd?, toNode, toSide?, toEnd?, color?, label?`）。`color` 是 `"1"`～`"6"` 預設色或 `#hex`。
- `parseCanvas(text)` → `{ doc, errors }`（未知欄位原樣保留在 `extra`）；`serializeCanvas(doc, original?)`：Obsidian 寫檔是 `JSON.stringify(data, null, '\t')` 加結尾換行；**沒動過時輸出 `original` 原文**（簽章比對同 2-3a 表格做法），動過才重新序列化，且節點順序、未知欄位保留。測試含「讀入再輸出一字不差」與「只動一個節點座標後其他節點文字不變」。

### 介面（`obsidian-canvas-page.tsx` 取代佔位，可拆檔）

1. 用 `@xyflow/react` 畫：`text` 節點顯示 markdown（`markdown-it`，與 2-3a 嵌入同設定；雙擊進 textarea 編輯）；`file` 節點顯示 `noteKeyOf(file)` 與該筆記前 300 字預覽（`readNote`），雙擊 `revealInFileTree`＋`setActiveFilePath`；`link` 節點顯示 URL（點擊 `openUrl`）；`group` 畫成有標籤的框，內含節點隨群組移動（xyflow `parentId`＋`extent`）；邊依 `fromSide`／`toSide` 接在對應側的 handle，`toEnd: arrow` 畫箭頭，`label` 顯示。顏色 1～6 對應 Obsidian 預設（紅、橙、黃、綠、青、紫 → 紫用琥珀替代只在 UI，**寫檔仍保留原值**）。
2. 可編輯：拖曳移動、縮放（xyflow NodeResizer）、文字節點編輯、新增文字節點（工具列）、刪除節點／邊、從一個節點拉邊到另一個。每次變更 debounce 500ms 後 `rewriteNote(filePath, () => serializeCanvas(doc, original))`。不做：undo／redo（瀏覽器 ⌘Z 只在 textarea 內）、群組新增、顏色選擇、貼上圖片。
3. 檔案在外部改動（Obsidian 同時開著）：索引 watcher 不管 `.canvas`，所以頁面自己用 `useEffect` 每次 `isActive` 變 true 時重讀；有未存變更時不覆蓋並 toast。
4. 空檔或解析失敗：顯示錯誤與「以文字開啟」（唯讀 textarea）。
5. i18n 頂層 `obsidianCanvas`：`title`、`addText`、`delete`、`parseError`、`openAsText`、`externalChange`（檔案在外部被修改，請重新開啟）、`untitledGroup`、`readOnly`。

### 測試

`format.test.ts`：規格範例往返；未知欄位保留；Tab 縮排與結尾換行；`serializeCanvas` 簽章。`obsidian-canvas-page.test.ts`（jsdom）：節點→xyflow 轉換（含群組 parent、邊的 side→handle）、變更→序列化、外部變更保護。

## 4. 軌道 C：大 vault 效能

### 基準工具

- `tests/perf/synthetic-vault.ts`：`makeSyntheticVault(n, seed)` 產生 n 篇筆記的 `{ path, content }`（10 個資料夾兩層、每篇 1～3 KB、frontmatter 3～6 個屬性、3 個標籤（含巢狀）、5 個 `[[連結]]`（含別名、標題、同名）、2 個任務、2 個標題、1 個 `^id`），固定 seed 可重現。
- `personal/make-test-vault.mjs` 加 `--big N`：在測試 vault 另建 `90 Big/` 放 N 篇同樣規則的筆記（給 Scott 實機看啟動時間用）；不影響原有樣本。
- `tests/perf/vault-perf.test.ts`：對 3,000 篇量測並斷言預算（預算放寬 3 倍避免 CI 抖動，實際數字 `console.info` 印出）：

| 項目 | 3,000 篇預算（Apple Silicon） |
|---|---|
| `indexNote` 全部 | ≤ 1.5 s |
| `serializeIndexCache`＋`restoreIndexCache` | ≤ 300 ms，JSON ≤ 15 MB |
| `selectBacklinks` 第一次（建反向索引） | ≤ 100 ms；之後每個路徑 ≤ 2 ms |
| `selectOutgoingLinks` | 同上 |
| `rankWikilinkSuggestions`（query 3 字） | ≤ 20 ms |
| `buildTagTree` | ≤ 50 ms |
| `buildLocalGraph` 深度 2 | ≤ 50 ms |
| `findUnlinkedMentions` 掃 3,000 篇內容 | ≤ 1 s |
| 10,000 篇 | 以上各項 ≤ 4 倍 |

### 最佳化（不改行為；既有測試預期一項都不能改）

1. `src/stores/vault-index.ts`：`selectBacklinks`／`selectOutgoingLinks` 現在對每個路徑各掃一次全部筆記，改成每個 `revision` 建一次反向索引（`Map<targetPath, BacklinkRef[]>`），單路徑查詢變 O(1)。
2. `links.ts`／`wikilink.ts` 的 `resolveWikilinkTarget` 對同一組 `paths` 重複建小寫對照表 → 在 store 層按 revision 快取一份 `{ byPath, byName }`，各 selector 共用（`wikilink.ts` 不能改，所以在 `links.ts` 加一個接受預建對照表的版本，舊函式保留）。
3. `service.ts`：`indexPaths` 並行數依檔案數調整（≤ 50 篇用 4，否則 8）；`saveCache` 用 `requestIdleCallback`（沒有時 `setTimeout`）；`listVault` 與 `planScan` 對 3,000 篇要 ≤ 200 ms（量測，必要時改為只比 mtime 不讀內容）。
4. `wikilink-suggest-model.ts`：`prepareNotes` 結果按 `notes` 參考快取（WeakMap）。
5. `graph.ts`：鄰接表按 revision 快取。
6. `unlinked-mentions.ts`：多個名稱合成一個 RegExp 一次掃，而不是每個名稱各掃一次。
7. 每項最佳化前後都在回報裡附量測數字。

## 5. 整合（PM）

1. 合併順序：C（底層）→ B（canvas）→ A（bases，含 `tiptap-editor.tsx` 掛載）。
2. FORK-CHANGES 修改清單＋驗收步驟；測試 vault 加 `.base` 樣本（兩個 view、filters、formula）、`.canvas` 樣本（四種節點、群組、各種 side 的邊）、```` ```base ```` 區塊筆記。
3. 開 PR 到 `dev`：「Phase 2-3b Bases 子集、.canvas 相容、大 vault 效能」。合併後 Phase 2 功能完成，進 2-4 試用期。

## 6. 不在本階段

Bases 的 cards／kanban／map view、summary 列、寫回 `.base`、在 UI 編輯 filter；canvas 的 undo、群組新增、顏色選擇、圖片節點；索引改用 worker thread 或 Rust 端（10,000 篇以上再評估）。
