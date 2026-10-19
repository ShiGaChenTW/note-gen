---
title: Phase 2-1 實作規格：基本雙鏈（L1 wikilink、L2 自動完成、L3 反向連結）
filename: 07-Phase2-1實作規格.md
created: 2026-10-19 04:25 (Asia/Taipei)
modified: 2026-10-19 05:30 (Asia/Taipei)
source_llm: Claude (Fable 5.1, Claude Code session，PM 角色)
status: 程式完成（2026-10-19），待實機驗收
---

# Phase 2-1 實作規格：基本雙鏈

> 本檔是 `docs/notegen-plan/07` 的版控副本（`docs/` 被 `.gitignore` 排除）。其他規劃文件仍在 `docs/notegen-plan/`，下方相對連結在該資料夾才有效。

依 [05-Phase2規劃](05-Phase2規劃.md) 的 2-1，與 [02-second-brain研究](02-second-brain研究.md) 第 4 節 #3～#6。
目標：在 NoteGen 內讀寫 Obsidian 的 `[[wikilink]]`，輸入 `[[` 有自動完成，右側欄能看到反向連結。
**存檔後檔案必須與 Obsidian 開同一檔時一字不差**，這是本階段唯一的硬性驗收。

## 0. 前提與假設

- Phase 1 程式已全部合併進 `dev`（PR #2、#3）；實機驗收仍待 Scott，與本階段平行進行。
- Phase 2 啟動前三個問題，先採假設：手機續用 Obsidian 開同一 vault；2-1 不需要必要外掛清單；vault 規模由 F3 索引實測。
- 工時基準：L1 12～20h、L2 4～6h、L3 6～8h（含索引擴充）。

## 1. 已就位的共用模組（PM 已完成）

`src/lib/markdown/wikilink.ts`（純函式，含測試 `wikilink.test.ts`）：

| 函式 | 用途 |
|---|---|
| `parseWikilink(raw)` | 解析單一 `[[...]]`／`![[...]]` → `{ raw, target, heading, blockId, alias, embed }`；支援 `\|` 表格轉義 |
| `findWikilinks(content)` | 全文找出所有 wikilink，含 `line`／`column`，跳過 fenced code 與 inline code；frontmatter 內加引號的也算 |
| `noteKeyOf(path)` | 去路徑與 `.md` 的筆記名稱 |
| `resolveWikilinkTarget(target, paths, sourcePath?)` | Obsidian 規則：完整路徑 > 檔名（不分大小寫）；同名時同資料夾優先、再最短路徑；附件要連副檔名；`''` 代表本篇 |
| `wikilinkDisplayText(link)` | 別名 > 檔名 > 標題 |
| `wikilinkTargetFor(path, paths)` | 產生要寫進 `[[ ]]` 的目標：唯一時只寫檔名，同名時寫完整路徑 |

三條軌道都**只能 import 這個模組，不能修改它**；覺得缺功能就在自己的檔案裡補，並在回報裡註明。

## 2. 分工與擁有權

| 軌道 | 功能 | 執行者 | 可改的檔案 |
|---|---|---|---|
| **A** | L1 wikilink 編輯器節點 | Claude Code（子代理） | 新檔 `src/app/core/main/editor/markdown/wikilink-extension.ts`、`tests/l1-wikilink-roundtrip.test.ts`；掛載點 `tiptap-editor.tsx`（只加 import 與 extensions 一行）、`markdown/style.css`（檔尾加樣式） |
| **B** | 連結索引擴充 ＋ L3 反向連結面板 | Codex | `src/lib/vault-index/index-note.ts`、新檔 `src/lib/vault-index/links.ts`（＋測試）、`src/stores/vault-index.ts`、新資料夾 `src/app/core/main/backlinks/`；掛載點 `src/components/plugins/plugin-right-sidebar.tsx`；6 個語系檔的頂層 `backlinks` 命名空間 |
| **C** | L2 `[[` 自動完成 | Grok | 新檔 `src/lib/wikilink-suggest-model.ts`（＋測試）、`src/app/core/main/editor/markdown/wikilink-suggest.tsx`；6 個語系檔 `editor.wikilinkSuggest` 命名空間。**不碰** `tiptap-editor.tsx`，掛載由 PM 在整合時加 |

共通規則：

- 不改 `package.json`／lockfile、不跑 `pnpm install`、不 push、不改 `personal/FORK-CHANGES.md`（PM 整合時統一寫）。
- 新功能放新檔案；上游檔案只加掛載點，並在回報中列出改了哪幾行。
- 單元測試用 vitest（`npx vitest run`），寫在 `src/**/*.test.ts` 或 `tests/**/*.test.ts`；交付前全部測試必須通過。
- i18n 六個語系（`messages/{en,zh,zh-TW,ja,de,pt-BR}.json`）都要補，key 放在規格指定的位置，避免合併衝突。
- 文字風格與現有 `today` 命名空間一致；繁中為主語系。
- agent 不 commit；變更留在工作樹，PM 審閱後代為 commit（實際執行時改為此規則）。

## 3. 軌道 A：L1 wikilink 編輯器節點

### 行為

1. 讀入：`[[Note]]`、`[[Note|別名]]`、`[[Note\|別名]]`、`[[Note#標題]]`、`[[Note#^id]]`、`[[#標題]]`、`[[folder/Note]]`、`![[嵌入]]` 都變成 **inline atom node `wikilink`**，attrs 直接沿用 `parseWikilink` 的欄位（`raw, target, heading, blockId, alias, embed`）。
2. 存檔：`renderMarkdown` 一律輸出 `attrs.raw`，一字不差。
3. 顯示：`<a data-type="wikilink" class="notegen-wikilink">` 顯示 `wikilinkDisplayText`；目標解析不到時多加 class `notegen-wikilink-unresolved`（虛線底線、較淡）。嵌入（`embed: true`）顯示為 `<span class="notegen-wikilink notegen-wikilink-embed">`，文字 `⧉ 檔名`，不可點，本階段不做轉入。
4. 解析狀態用 ProseMirror plugin 的 decorations 計算（不要寫進 attrs，否則會汙染存檔）：路徑來源 `useVaultIndexStore.getState().notes.keys()`；訂閱 store，`revision` 變動時重算。
5. 點擊（左鍵或 ⌘/Ctrl 左鍵）：`resolveWikilinkTarget(target, paths, activeFilePath)` 有結果 → `await revealInFileTree(path)`（`src/lib/daily/note-io.ts`）再 `useArticleStore.getState().setActiveFilePath(path)`；解析不到 → 建立新筆記：目標含 `/` 就用該相對路徑，否則放在目前筆記的同一資料夾，內容 `# 名稱\n`，用 `note-io.ts` 的 `noteExists`／`writeNote`，建好再開啟。`[[#標題]]` 點了不動作。本階段不捲動到標題。
6. 游標：atom node，方向鍵跳過、Backspace 整個刪除。不做就地編輯。
7. 不處理 code block、inline code 裡的 `[[ ]]`（tokenizer 層級 `inline`，marked 的 code 已先吃掉；用測試確認）。

### 實作提示

- 參考同資料夾的 `frontmatter-extension.ts`（block 節點）與 `math-extension.tsx` 第 250～350 行（inline tokenizer，`markdownTokenizer.level: 'inline'`、`start`、`tokenize`、`parseMarkdown`、`renderMarkdown`）。
- tokenizer `start` 要同時認 `[[` 與 `![[`；`tokenize` 用 `parseWikilink` 驗證，失敗回 `undefined` 讓文字照原樣走。
- 掛載：`tiptap-editor.tsx` 的 `useEditor` extensions 裡，在 `RecurringTask` 旁加一行；import 放在第 36 行附近。
- 編輯器既有的 `Link` mark 設了 `openOnClick: false`，點擊由自己的 plugin `handleClick` 處理。

### 驗收測試（`tests/l1-wikilink-roundtrip.test.ts`）

照 `tests/f1-frontmatter-roundtrip.test.ts` 的 harness（jsdom、同一組 extensions 再加 `Wikilink`），每個樣本 `save(load(x)) === x`：

- 段落開頭／結尾／中間、CJK 前後無空格、相鄰 `[[A]][[B]]`
- 清單與任務項：`- [ ] 讀 [[書名|這本]] 📅 2026-10-20`
- 表格列 `| [[A\|a]] | [[B]] |`
- `![[圖.png]]`、`![[Note#段落]]`
- 行內 code `` `[[x]]` `` 與 fenced code 內的 `[[x]]` 原樣
- frontmatter `related: "[[Front]]"`（與 `Frontmatter` 節點並存）
- 同時測 `editor.getJSON()` 中節點數量正確（例如 `[[A]][[B]]` 是兩個 node）。

## 4. 軌道 B：連結索引擴充 ＋ L3 反向連結面板

### B-1 索引（`src/lib/vault-index/index-note.ts`）

- `IndexedNote.links` 從 `string[]` 改成 `IndexedLink[]`：

  ```ts
  interface IndexedLink {
    kind: 'wikilink' | 'markdown'
    /** wikilink：`[[ ]]` 內 `#`、`|` 前的目標；markdown：已換算成 vault 相對路徑（含 .md） */
    target: string
    alias: string
    heading: string
    embed: boolean
    /** 0 起算、對整份檔案的行號 */
    line: number
    /** 該行去頭尾空白、最長 160 字、以連結為中心截斷 */
    context: string
  }
  ```

  - wikilink 用 `findWikilinks(content)`（整份內容，含 frontmatter）。
  - markdown 連結 `[text](path)`：只收相對路徑且副檔名 `.md`；跳過 `http(s):`、`mailto:`、`#`、`![`；`%20` 等要 decode；`../` 依來源筆記資料夾換算；跳過 code。
- `aliases`：frontmatter `aliases`（或 `alias`），字串或清單，trim、去空、去重。
- `tags`：frontmatter `tags`（或 `tag`，字串可用逗號／空白分隔，或清單）＋內文 `#tag`：regex 以行首或空白／`(`／`（` 前導，`#` 後接非空白非標點，允許 `a/b` 巢狀；行首 `# ` 標題不算；URL 內的 `#` 不算；跳過 code；去掉 `#`，保留原大小寫，去重。
- `INDEX_SCHEMA_VERSION` 改成 `2`。
- `vault-index.test.ts` 既有的 `[[], [], []]` 預期要改，並補 links／aliases／tags 案例。

### B-2 查詢（新檔 `src/lib/vault-index/links.ts`，純函式）

- `resolveIndexedLink(link, notePaths, sourcePath): string | null`：wikilink 走 `resolveWikilinkTarget`；markdown 直接比對路徑（不分大小寫）。
- `collectBacklinks(targetPath, notes: Iterable<IndexedNote>): BacklinkRef[]`，`BacklinkRef = IndexedLink & { sourcePath: string }`，排除自己連自己，依 `sourcePath`、`line` 排序。
- `collectOutgoingLinks(path, notes): Array<IndexedLink & { resolved: string | null }>`。
- 測試 `links.test.ts`：同名筆記解析、markdown 相對連結、別名、嵌入、排序。

### B-3 Store（`src/stores/vault-index.ts`）

- `selectBacklinks(state, targetPath)`、`selectOutgoingLinks(state, path)`：仿 `selectAllTasks` 以 `revision` 記憶，但要按路徑分開快取（`Map<path, …>`，revision 變了整個清掉）。

### B-4 面板（新檔 `src/app/core/main/backlinks/backlinks-panel.tsx`）

- 資料：`useArticleStore(state => state.activeFilePath)`；非 `.md` 或沒有開檔時顯示提示文字。
- 區塊一「連結到這篇 N」：依來源筆記分組（顯示 `noteKeyOf(sourcePath)`，資料夾路徑用淡色小字），每筆顯示 `context`，`raw`／連結文字用 `<mark>` 強調；點擊 → `revealInFileTree(sourcePath)`（`src/lib/daily/note-io.ts`）後 `setActiveFilePath(sourcePath)`。
- 區塊二「本篇連出 N」：可收合，列出 target，`resolved === null` 的標示「尚未建立」。
- 空狀態：「還沒有筆記連到這篇」。索引 `status !== 'ready'` 時顯示「索引中…」。
- 樣式沿用專案 Tailwind／shadcn 慣例，琥珀 `#fbbd23` 當強調色（`text-primary`／`bg-primary/10`），不用紫色。
- 掛載 `src/components/plugins/plugin-right-sidebar.tsx`：加一個內建 tab `@backlinks`（lucide `Link2` icon）放在 `@chat` 之後；**沒有外掛貢獻時目前會直接 `return <Chat />`，要改成也畫 Tabs**。`TabsContent` 用 `forceMount` + `data-[state=inactive]:hidden` 與 chat 一致。回報時列出改動行。
- i18n：六個語系檔都加頂層 `backlinks` 命名空間，**插在頂層 `today` 之後**：`title`（反向連結）、`linked`（連結到這篇）、`outgoing`（本篇連出）、`empty`、`indexing`、`notMarkdown`、`unresolved`（尚未建立）。

## 5. 軌道 C：L2 `[[` 自動完成

### C-1 純函式（新檔 `src/lib/wikilink-suggest-model.ts` ＋ `wikilink-suggest-model.test.ts`）

- `findWikilinkInputContext(textBeforeCursor): { query: string, from: number } | null`：游標前最後一個 `[[`（前面不是 `\`，`![[` 也算）到游標之間沒有 `]]`、`\n`、`[`、`]`；回傳 query 與 `[[` 起點。
- `rankWikilinkSuggestions({ query, notes, currentPath, limit = 8 })`，`notes: Array<{ path: string, aliases: string[] }>`（只收 `.md`）→ `Suggestion[]`：
  `{ path, label, folder, matchedAlias: string | null, score }`。排序：名稱前綴 > 別名前綴 > 名稱子序列 > 別名子序列 > 路徑子序列；同分時最近修改／較短路徑優先；空 query 列最近開過的（`recentPaths` 可選）。中文不分大小寫問題，但要 `toLowerCase()`。
- `buildWikilinkInsertion({ suggestion, allPaths, hasClosingBrackets }): string`：
  目標用 `wikilinkTargetFor(path, allPaths)`；用別名選到時輸出 `[[目標|別名]]`；`hasClosingBrackets` 為 true（游標後面已經是 `]]`）時不重複補 `]]`。
- `buildCreateInsertion(query)` → `[[query]]`。
- 以上全部要有測試。

### C-2 元件（新檔 `src/app/core/main/editor/markdown/wikilink-suggest.tsx`）

- `export function WikilinkSuggest({ editor, activeFilePath }: { editor: Editor, activeFilePath: string })`，結構照 `smart-file-link.tsx`：監聽 `editor.on('transaction')`、`selectionUpdate`、`blur`；用 `findWikilinkInputContext` 判斷是否顯示；`editor.view.coordsAtPos` 定位；`selection.$from.parent.type.spec.code` 時不顯示。
- 資料：`useVaultIndexStore`（`notes` Map → `.md` 路徑與 `aliases`；`revision` 變動重算）。索引未就緒時退回 `getAllMarkdownFiles`（`src/lib/files.ts`）的路徑清單。
- 鍵盤：↑↓ 選擇、Enter／Tab 送出、Esc 關閉；攔截方式照 `smart-file-link.tsx` 第 269～288 行（`editor.view.dom` 的 keydown，capture）。
- 送出：`editor.chain().focus().insertContentAt({ from: ctxFrom, to: cursor }, text).run()`，游標落在 `]]` 之後。
- 清單最多 8 筆 ＋ 最後一列「建立「query」」（query 非空且無完全同名時）。每筆顯示名稱、淡色資料夾、別名時加 badge「別名」。
- i18n：六個語系檔 `editor` 物件內、`smartFileLink` 之後加 `wikilinkSuggest`：`create`（建立「{name}」）、`alias`（別名）、`noResults`（沒有符合的筆記）。
- **不改 `tiptap-editor.tsx`**。回報裡寫明掛載方式（預期：在 `<SmartFileLink … />` 旁加 `<WikilinkSuggest editor={editor} activeFilePath={activeFilePath} />`）。

## 6. 整合（PM）

1. 合併順序：B（索引）→ A（節點）→ C（自動完成），每步跑全部測試。
2. 加 C 的掛載、檢查 A／C 兩者在 `tiptap-editor.tsx` 的改動不互相干擾。
3. 寫 `personal/FORK-CHANGES.md`（修改清單 ＋ 測試步驤）。
4. `npx pnpm@9 tauri dev` 冒煙：開一篇含 `[[ ]]` 的筆記 → 顯示、點擊、存檔 diff 為空；輸入 `[[` 有選單；右側欄有反向連結。
5. 開 PR 到 `dev`：「Phase 2-1 基本雙鏈：L1–L3」。

## 7. 不在本階段

`![[嵌入]]` 轉入、`#標題` 捲動、block ref 跳轉、改名改寫連結（L7）、未連結提及（L4）、標籤（L6）、屬性面板（L5）、graph（L8）。
