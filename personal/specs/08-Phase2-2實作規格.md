---
title: Phase 2-2 實作規格：知識庫整理（L5 屬性面板、L7 改名改寫連結、L6 筆記標籤、L4 未連結提及）
filename: 08-Phase2-2實作規格.md
created: 2026-10-19 16:30 (Asia/Taipei)
modified: 2026-10-19 16:30 (Asia/Taipei)
source_llm: Claude (Fable 5.1, Claude Code session，PM 角色)
status: 派工中（2026-10-19）
---

# Phase 2-2 實作規格：知識庫整理

> 本檔是版控正本（`docs/` 被 `.gitignore` 排除，`docs/notegen-plan/08` 只是副本）。其他規劃文件在 `docs/notegen-plan/`，下方相對連結在該資料夾才有效。

依 [05-Phase2規劃](05-Phase2規劃.md) 的 2-2，與 [02-second-brain研究](02-second-brain研究.md) 第 4 節 #2、#7、#8、#9，接在 [07-Phase2-1實作規格](07-Phase2-1實作規格.md) 之後。
目標：NoteGen 能整理知識庫，不只是讀寫雙鏈：看得到、改得了 frontmatter 屬性；改名或搬動筆記時連入的 `[[ ]]` 跟著改；左側欄有筆記標籤樹；反向連結面板多一區「未連結提及」可一鍵轉成連結。
**所有寫回 vault 的功能，沒動到的行必須一字不差**，這是本階段唯一的硬性驗收；Obsidian 同時開著也不能把檔案改壞。

## 0. 前提與假設（Scott 指示先用預設前置設定）

05 的三個啟動前問題尚未回答，本階段採以下預設；答案不同時只影響 2-3 的排序與效能目標，不影響 2-2 的介面：

1. **手機**：手機續用 Obsidian 開同一個 vault，不做行動版。推論：Obsidian 可能與 NoteGen 同時開著同一 vault，所以 L7 改寫連結**預設先詢問**，L5 寫 frontmatter 只改動到的 key。
2. **必要外掛**：假設 Tasks、Dataview、Templater。2-2 不依賴此清單；只要求 L5 不把 Dataview 行內欄位（`key:: value`）當成屬性。
3. **vault 規模**：假設 ≤ 3,000 篇、≤ 200 MB。推論：L4 未連結提及要讀全文，採「展開時才掃描、依索引 revision 快取」，不常駐記憶體；L6 標籤樹直接用索引已有的 `tags`。

其他前提：

- Phase 2-1 已合併 `dev`（PR #4，2026-10-19），索引 `INDEX_SCHEMA_VERSION = 2` 已有 `links`、`aliases`、`tags`、`frontmatter`。
- 工時基準（03）：L5 16～24h、L7 10～14h、L6 12～16h、L4 6～10h。
- 已知限制延續：resolver 只認完整路徑或純檔名（2-2 的 L7 要補「相對本篇資料夾的部分路徑」，見 §3）。

## 1. 已就位的共用模組（PM 已完成）

| 模組 | 用途 |
|---|---|
| `src/lib/note-rewrite.ts`（新，含測試） | `rewriteNotes([{ path, rewrite }])`／`rewriteNote(path, fn)`：改寫可能正在編輯器裡開著的筆記。照上游 `markdown-media-path.ts` 的做法：走 `runEditorPathWriteTransaction` 排隊、寫前重讀最新內容、開著的那篇用 `currentArticle` 當來源並在寫完後發 `editor-file-content-updated` 與 `external-content-update` 讓編輯器重載；任一篇失敗整批還原並丟 `NoteRewriteConflictError`。**L5、L7、L4 寫檔一律用它，不要自己碰 Tauri fs。** |
| `src/lib/markdown/wikilink.ts` | 2-1 的 `parseWikilink`、`findWikilinks`、`noteKeyOf`、`resolveWikilinkTarget`、`wikilinkTargetFor`、`wikilinkDisplayText` |
| `src/lib/markdown/frontmatter-split.ts` | `splitFrontmatter(raw)` → `{ block, body }`（`block + body === raw`）、`joinFrontmatter`、`findFrontmatterEnd` |
| `src/lib/vault-index/index-note.ts`、`links.ts`、`src/stores/vault-index.ts` | `IndexedNote { path, mtime, frontmatter, tasks, links, aliases, tags }`；`collectBacklinks`／`collectOutgoingLinks`；`selectBacklinks`／`selectOutgoingLinks`；`useVaultIndexStore` 的 `notes`、`revision`、`status` |
| `src/lib/daily/note-io.ts` | `readNote`／`writeNote`／`noteExists`／`revealInFileTree`（讀 `.obsidian/types.json` 也用 `readNote`，隱藏資料夾不受檔案樹過濾影響） |
| `src/lib/markdown-media-path.ts`（上游） | L7 的參考：`rewriteWorkspaceMarkdownMediaPaths(moves)` 已掛在三個改名／搬動點上，L7 的呼叫**緊接在它後面**（見 §3） |

三條軌道都**只能 import 這些模組，不能修改**（例外：軌道 C 可以在 `src/stores/vault-index.ts` 檔尾加 selector）。覺得缺功能就在自己的檔案裡補，並在回報裡註明。

## 2. 分工與擁有權

| 軌道 | 功能 | 執行者 | 可改的檔案 |
|---|---|---|---|
| **A** | L7 改名改寫連結 ＋ L4 未連結提及 | Claude Code（子代理） | 新檔 `src/lib/markdown/wikilink-rewrite.ts`（＋測試）、`src/lib/wikilink-rename.ts`、`src/app/core/main/link-rewrite/`（新資料夾）、`src/lib/markdown/unlinked-mentions.ts`（＋測試）、`src/lib/vault-index/unlinked-mentions-scan.ts`；fork 檔 `src/app/core/main/backlinks/backlinks-panel.tsx`、`src/app/core/main/fork-services.tsx`；掛載點 `src/app/core/main/file/file-item.tsx`、`file-dnd.ts`、`folder-item/index.tsx`（各加一段 ≤ 5 行）；6 個語系檔：頂層 `linkRewrite`（插在 `today` 之後、`backlinks` 之前）＋ `backlinks` 物件**尾端**追加 key |
| **B** | L5 屬性面板 | Codex | 新檔 `src/lib/markdown/frontmatter-edit.ts`（＋測試）、`src/lib/obsidian-types.ts`、`src/app/core/main/properties/`（新資料夾）；掛載點 `src/components/plugins/plugin-right-sidebar.tsx`；6 個語系檔：頂層 `properties`（插在 `backlinks` 之後、`settings` 之前） |
| **C** | L6 筆記標籤 | Grok | 新檔 `src/lib/vault-index/tags.ts`（＋測試）、`src/app/core/main/note-tags/`（新資料夾）；`src/stores/vault-index.ts` 檔尾加 selector；掛載點 `src/stores/sidebar.ts`、`src/app/core/main/left-sidebar.tsx`；6 個語系檔：頂層 `noteTags`（插在頂層 `tags` 之後）＋ `navigation` 物件尾端加 `noteTags` |

共通規則（與 2-1 相同）：

- 不改 `package.json`／lockfile、不跑 `pnpm install`、不 commit、不 push、不改 `personal/FORK-CHANGES.md`（PM 整合時統一寫）。
- 新功能放新檔案；上游檔案只加掛載點，並在回報中列出改了哪幾行。
- 單元測試用 vitest（`npx vitest run`），寫在 `src/**/*.test.ts` 或 `tests/**/*.test.ts`；交付前全部測試必須通過（目前 23 檔 331 項）。
- i18n 六個語系（`messages/{en,zh,zh-TW,ja,de,pt-BR}.json`）都要補，key 放在上表指定位置，避免合併衝突。文字風格與 `backlinks`、`today` 命名空間一致；繁中為主語系。
- 樣式沿用 Tailwind／shadcn 慣例，琥珀 `#fbbd23` 當強調色（`text-primary`／`bg-primary/10`），不用紫色。面板結構照 `src/app/core/main/backlinks/backlinks-panel.tsx`。
- 寫回檔案的測試都要包含「沒動到的行一字不差」與 CRLF 樣本。

## 3. 軌道 A-1：L7 改名改寫連結

### 行為

1. 在檔案樹改名、拖曳搬動、資料夾改名後（三個上游掛載點已經各自呼叫 `rewriteWorkspaceMarkdownMediaPaths([...moves])`），緊接著呼叫 `requestLinkRewrite(moves)`。
2. `requestLinkRewrite` 用索引算出受影響的筆記與連結數：
   - 連結指向被搬動檔案的筆記（含 frontmatter 內加引號的 `"[[x]]"`、`![[嵌入]]`、相對路徑 markdown 連結 `[t](../x.md)`）。
   - 被搬動的筆記本身：它的相對路徑 markdown 連結要以新位置重算；它的 wikilink 若用了「相對本篇資料夾的部分路徑」也要重算。
3. 0 筆 → 靜默結束。否則跳 AlertDialog：「{files} 篇筆記共 {links} 個連結指向被改名的檔案，要一併改寫嗎？」，說明 Obsidian 同時開著時可能也會改；按鈕「改寫」「不改寫」。本階段每次都問，不做「記住選擇」。
4. 改寫規則（照 Obsidian）：新目標用 `wikilinkTargetFor(newPath, pathsAfter)`（唯一時只寫檔名，同名時完整路徑）；保留 `#標題`、`#^block`、`|別名`（表格內 `\|` 形式保留）、`!` 嵌入；別名不存在時不自動補。markdown 連結改成從來源筆記新位置算的相對路徑，原本有 `%20` 編碼就維持編碼。沒變的連結一字不動。
5. 改寫用 `rewriteNotes`，失敗時 toast「改寫失敗，檔案已還原」；**不回滾檔案改名**（改名已成功，連結改寫是附加動作），所以 `requestLinkRewrite` 內部要 catch，不讓錯誤冒到上游的 try／rollback。
6. 成功後 toast「已更新 {files} 篇筆記」。索引由 watcher 自動更新，不用手動 upsert。

### 純函式（新檔 `src/lib/markdown/wikilink-rewrite.ts` ＋ `wikilink-rewrite.test.ts`）

- `export interface PathMove { sourcePath: string; targetPath: string }`（與上游 `WorkspacePathMove` 同形，資料夾搬動用前綴對應）。
- `mapMovedPath(path, moves): string`：等於或在 `sourcePath/` 之下就換前綴，否則原樣。
- `resolveLinkTarget(target, paths, sourcePath)`：**補上 2-1 缺的部分路徑**：先照 `resolveWikilinkTarget`；解析不到且 target 含 `/` 時，再試 `來源資料夾/target`（Obsidian「Relative path to file」格式）。軌道 A 自己的檔案裡實作，不改 `wikilink.ts`。
- `rewriteLinksForMoves({ content, sourcePathBefore, sourcePathAfter, moves, pathsBefore, pathsAfter }): { content: string, count: number }`：
  - 用 `findWikilinks(content)` 取所有 wikilink（已跳過 code）；每個 target 以 `pathsBefore` 與 `sourcePathBefore` 解析；解析到的路徑經 `mapMovedPath` 有變，或來源自己被搬動且原本是部分路徑／完整路徑寫法時，重組 raw。
  - markdown 連結：regex 找 `[text](target)`（跳過 `http(s):`、`mailto:`、`#`、`![`、code；`%20` decode 後解析），目標或來源被搬動時改成新的相對路徑。
  - 由後往前替換，避免位移。
- `collectLinkRewriteCandidates(moves, notes: Iterable<IndexedNote>): string[]`：用索引 `links` 預先篩出可能受影響的筆記路徑（連到被搬動檔案的，加上被搬動的筆記本身），避免全 vault 讀檔。**注意掛載當下 watcher 還沒更新索引：索引裡仍是舊路徑**，所以 `pathsBefore = notes.keys()`，`pathsAfter = pathsBefore.map(mapMovedPath)`，被搬動筆記要以新路徑讀檔、舊路徑查索引。

測試樣本：單檔改名（別名、標題、嵌入、表格 `\|`、frontmatter 引號內）；同名筆記搬到另一資料夾後其他連結從檔名變完整路徑，反之亦然；資料夾改名影響子筆記；被搬動筆記自己的 `[t](../x.md)`；code 內不改；沒變的檔案回傳 `count 0` 且內容相同；CRLF。

### I/O 與 UI

- `src/lib/wikilink-rename.ts`：`planLinkRewrite(moves)` → `{ files: Array<{ path, count }>, totalLinks }`（讀候選檔案、跑純函式、丟掉 count 0）；`applyLinkRewrite(plan)` → `rewriteNotes`。
- `src/app/core/main/link-rewrite/link-rewrite-prompt.tsx`：全域一個 `<LinkRewritePrompt />`，掛在 `fork-services.tsx`；`requestLinkRewrite(moves)` 把請求放進 zustand 小 store（同資料夾 `link-rewrite-store.ts`），元件用 shadcn `AlertDialog` 顯示並 resolve 決定。
- 掛載點（各一段，回報行號）：
  - `src/app/core/main/file/file-item.tsx` 約 575～578 行 `rewriteWorkspaceMarkdownMediaPaths([...])` 之後：`await requestLinkRewrite([{ sourcePath: path, targetPath: targetRelativePath }])`。
  - `src/app/core/main/file/file-dnd.ts` 約 205～208 行之後，同樣以 `moved` 組 moves。
  - `src/app/core/main/file/folder-item/index.tsx` 約 498～501 行之後。
- i18n 頂層 `linkRewrite`：`title`（更新連結）、`description`（含 `{files}`、`{links}`）、`obsidianHint`、`confirm`（改寫）、`skip`（不改寫）、`done`（已更新 {files} 篇筆記）、`failed`。

## 4. 軌道 A-2：L4 未連結提及

### 純函式（新檔 `src/lib/markdown/unlinked-mentions.ts` ＋測試）

- `findUnlinkedMentions(content, names: string[]): Mention[]`，`Mention = { line, column, length, text, context }`（`line` 對整份檔案 0 起算，`context` 規則同索引的 `linkContext`：該行最多 160 字、以命中為中心）。
  - `names` = 目標筆記的 `noteKeyOf(path)` ＋ `aliases`；長度 < 2 或純數字的名稱略過；同一位置多個名稱命中取最長。
  - 比對：ASCII 不分大小寫；**邊界規則**：名稱首尾若是 ASCII 字母或數字，相鄰字元不可以是 ASCII 字母／數字／`_`（`Note` 不命中 `Notes`）；CJK 不套邊界（中文沒有空格）。
  - 跳過：frontmatter、fenced／inline code、`[[...]]` 內、markdown 連結的 `[文字](目標)` 整段、URL（`https://…` 連續非空白）、`#tag` 內。標題行要算（Obsidian 也算）。
- `linkMention(content, mention, target): string`：把那一段換成 `[[target]]`；命中文字與 `target` 不同（大小寫或別名）時寫 `[[target|命中文字]]`。`target` 由呼叫端用 `wikilinkTargetFor(targetPath, paths)` 算。

### 掃描（新檔 `src/lib/vault-index/unlinked-mentions-scan.ts`）

- `scanUnlinkedMentions(targetPath, { notes, revision, readNote, signal })` → `Array<{ sourcePath, mentions }>`：候選＝索引裡所有 `.md`（排除目標本身），**並行 8 個** `readNote`，跑純函式；結果依 `targetPath + revision` 快取一份（模組層 Map，最多留 20 筆）；`signal` 中止時丟掉結果。

### UI（改 fork 檔 `src/app/core/main/backlinks/backlinks-panel.tsx`）

- 在「本篇連出」之後加第三區「未連結提及 N」，預設收合；展開時才掃描（顯示「掃描中…」）；索引 revision 變了下次展開重掃。
- 每筆顯示來源筆記（分組同「連結到這篇」）、上下文並 `<mark>` 命中文字；每筆有「連結」按鈕，群組頂端有「全部連結」；點上下文開啟來源筆記。
- 「連結」→ `rewriteNote(sourcePath, content => linkMention(...))`（同一篇多筆要由後往前一次改完）；成功後該筆從清單移除，索引 watcher 之後會把它算進「連結到這篇」。
- i18n：在 6 個語系的 `backlinks` 物件**尾端**追加：`unlinked`（未連結提及）、`scan`、`scanning`（掃描中…）、`linkOne`（連結）、`linkAll`（全部連結）、`unlinkedEmpty`（沒有未連結的提及）、`linkDone`（已轉成連結）、`linkFailed`。

## 5. 軌道 B：L5 屬性面板

### 行為（照 Obsidian Properties）

1. 右側欄新 tab「屬性」（`@properties`，lucide `SlidersHorizontal`），放在「反向連結」之後。開著 `.md` 時顯示該篇 frontmatter 的 key／value 列表；沒有 frontmatter 顯示「這篇還沒有屬性」＋「新增屬性」。
2. 型別（Obsidian 八種）：`text`、`multitext`（清單）、`number`、`checkbox`、`date`、`datetime`、`tags`、`aliases`；判斷順序：vault 的 `.obsidian/types.json`（`{ "types": { key: type } }`）> key 是 `tags`／`aliases`／`cssclasses`（多值）> 值：布林→checkbox、數字→number、`YYYY-MM-DD`→date、`YYYY-MM-DDTHH:mm(:ss)?`→datetime、純量陣列→multitext、其餘→text。巢狀物件、多行字串、含非純量的陣列 → `unsupported`，唯讀顯示原文並提示用原始碼。
3. 每列：key（雙擊改名）、型別圖示、值的編輯元件：text＝Input、number＝Input type=number、checkbox＝Checkbox、date＝Input type=date、datetime＝datetime-local、multitext／tags／aliases＝chip 列（Enter 新增、× 移除，tags 顯示 `#`）；列尾選單「刪除」。
4. 「新增屬性」：key 輸入有自動完成（全 vault 索引 `frontmatter` 的 key 聯集，依出現次數排序）；型別依 §2 規則或 `types.json`；新 key 加在 frontmatter 最後一行之後。
5. 「原始碼」切換：textarea 顯示原始 YAML（不含 `---`），「套用」先 `yaml` parse 驗證，失敗顯示錯誤不寫；成功則整塊換掉。
6. 寫回：全部透過 `rewriteNote(activeFilePath, content => applyFrontmatterEdit(content, edit))`；編輯器會自動重載（Frontmatter 節點是 atom，重載沒有游標問題）。面板資料來源是 `useArticleStore` 的 `activeFilePath` 與 `currentArticle`（存檔後更新，500ms 防抖），不要自己讀檔。
7. 不做：Visible／Hidden 模式、Dataview 行內欄位 `key:: value`（不是屬性）、類型全域修改（寫 `types.json`）。

### 純函式（新檔 `src/lib/markdown/frontmatter-edit.ts` ＋ `frontmatter-edit.test.ts`）

- `type PropertyType = 'text' | 'multitext' | 'number' | 'checkbox' | 'date' | 'datetime' | 'tags' | 'aliases' | 'unsupported'`
- `inferPropertyType(key, value, typeMap: Record<string, PropertyType>): PropertyType`
- `listProperties(block, typeMap): Property[]`，`Property = { key, value: unknown, type, editable: boolean, raw: string }`；`block` 是 `splitFrontmatter` 的 `block`（含 `---`），空字串回 `[]`。
- `type FrontmatterEdit = { kind: 'set', key, value, type } | { kind: 'remove', key } | { kind: 'rename', key, newKey } | { kind: 'replaceSource', yaml }`
- `applyFrontmatterEdit(content, edit, typeMap?): string`：
  - 用 `yaml` 的 `parseDocument(yamlText)` 取節點 `range`，**只替換該 key 的文字範圍**，其他行一字不差（含註解、引號風格、空行、key 順序）。
  - 純量寫法照 Obsidian：字串能裸寫就裸寫，含 `: `、`#`、開頭 `[`／`"`／`'`、或是 `[[wikilink]]` 時用雙引號；日期裸寫；布林 `true`／`false`。
  - 清單一律寫 block 風格（`key:\n  - a\n  - b`），空清單 `key: []`；原本是 flow 風格 `[a, b]` 的 key 被改時也換成 block（記在回報）。
  - 沒有 frontmatter 時 `set` 會在檔首（BOM 之後）插入 `---\nkey: value\n---\n`，與內文之間保留原本的第一行（不多加空行）。
  - `remove` 刪掉該 key 的整個節點範圍含換行；最後一個 key 刪掉後整個 frontmatter 移除。
  - `replaceSource` 以新 YAML 取代 `---` 之間的內容；呼叫端先驗證。
  - 行尾用檔案原本的 `\n` 或 `\r\n`。
- 測試：每種型別 set／add／remove／rename；同行註解 `key: v # 註解` 改值後註解仍在；引號內 `"[[連結]]"`；flow 清單改 block；巢狀物件判 `unsupported` 且 `set` 其他 key 時它一字不動；CRLF；沒有 frontmatter 新增；刪到空。每個案例都斷言「未觸及的行一字不差」。

### `.obsidian/types.json`（新檔 `src/lib/obsidian-types.ts`）

- `loadObsidianPropertyTypes(): Promise<Record<string, PropertyType>>`：`readNote('.obsidian/types.json')`，沒有或壞掉回 `{}`；對應 Obsidian 型別名（`text`、`multitext`、`number`、`checkbox`、`date`、`datetime`、`tags`、`aliases`）；模組層快取，`useVaultIndexStore` 的 `workspace` 變了重讀。只讀不寫。

### UI 與掛載

- `src/app/core/main/properties/properties-panel.tsx`（＋ `properties-panel.test.ts` 測純邏輯：列表轉換、型別圖示對應、key 自動完成排序）。
- 掛載 `src/components/plugins/plugin-right-sidebar.tsx`：`TabsTrigger value="@properties"` 放在 `@backlinks` 之後；`TabsContent forceMount`；`useEffect` 的判斷補 `active !== '@properties'`；`Tabs value` 的對應補 `@properties`；`useTranslations('properties')`。回報改動行。
- i18n 頂層 `properties`：`title`（屬性）、`add`（新增屬性）、`empty`、`source`（原始碼）、`apply`（套用）、`invalidYaml`、`keyPlaceholder`（屬性名稱）、`valuePlaceholder`、`remove`、`rename`、`unsupported`（不支援的格式，請用原始碼編輯）、`notMarkdown`、`types.{text,multitext,number,checkbox,date,datetime,tags,aliases}`。

## 6. 軌道 C：L6 筆記標籤

### 行為

1. 左側欄新 tab「筆記標籤」（lucide `Hash`），放在「畫布」之後；與上游「記錄」的標籤（SQLite）完全分開，不共用 store。
2. 標籤樹：以 `/` 分層（`#a/b/c`），每節點顯示名稱與筆記數（含子標籤，去重）；展開／收合；預設依名稱排序，可切「依數量」；頂端搜尋框過濾（命中節點的祖先自動展開）。
3. 點節點 → 下方列出筆記（名稱＋淡色資料夾路徑，含子標籤的筆記），點筆記 `revealInFileTree` 後 `setActiveFilePath`。
4. 索引 `status !== 'ready'` 顯示「索引中…」；沒有任何標籤顯示空狀態。
5. 標籤比對不分大小寫（Obsidian 規則），顯示用第一次遇到的寫法。
6. 不做：點 `#tag` 跳轉（編輯器內仍是純文字）、改名標籤、寫檔（frontmatter `tags` 的編輯走 L5）。

### 純函式（新檔 `src/lib/vault-index/tags.ts` ＋ `tags.test.ts`）

- `normalizeTag(tag): string`（去前導 `#`、trim、小寫比較鍵）。
- `buildTagTree(notes: Iterable<IndexedNote>): TagNode[]`，`TagNode = { name, fullPath, count, children: TagNode[] }`，`count` 是去重後的筆記數（同一篇同時有 `a` 與 `a/b` 只算一次）。
- `collectNotesForTag(fullPath, notes, { includeNested = true }): string[]`（路徑排序）。
- `filterTagTree(tree, query): TagNode[]`（保留命中節點與祖先）。
- `sortTagTree(tree, by: 'name' | 'count')`。

### Store（`src/stores/vault-index.ts` 檔尾）

- `selectTagTree(state)`：仿 `selectAllTasks` 以 `revision` 記憶。

### UI 與掛載

- `src/app/core/main/note-tags/note-tags-sidebar.tsx`（＋ `note-tags-sidebar.test.ts` 測展開狀態與過濾邏輯）。
- `src/stores/sidebar.ts`：`BUILT_IN_LEFT_SIDEBAR_TABS` 加 `'noteTags'`（一行）。
- `src/app/core/main/left-sidebar.tsx`：`SIDEBAR_TABS` 加 `{ title: 'noteTags', icon: Hash }`；`allTabs` 的翻譯對應不用改（會走 `navigation.noteTags`）；加一個 `TabsContent forceMount value="noteTags"`；工具列那三個 `motion.div` 不用動（本 tab 沒有動作列）。回報改動行。
- `src/app/core/main/sidebar-search.tsx` 的 `SidebarTab` 型別若因此報錯，只做最小型別補充並回報。
- i18n：頂層 `noteTags`（插在頂層 `tags` 之後）：`title`（筆記標籤）、`search`（搜尋標籤）、`sortByName`、`sortByCount`、`notes`（{count} 篇筆記）、`empty`（還沒有標籤）、`indexing`（索引中…）；`navigation` 物件尾端加 `noteTags`（筆記標籤）。

## 7. 整合（PM）

1. 合併順序：C（標籤，改動面最小）→ B（屬性）→ A（改名＋未連結提及），每步跑全部測試。
2. 檢查三軌在 6 個語系檔的插入位置沒有互相覆蓋；檢查右側欄 tab 順序：對話、反向連結、屬性。
3. 寫 `personal/FORK-CHANGES.md`（修改清單 ＋ 測試步驟），`personal/make-test-vault.mjs` 加 2-2 樣本（`60 Notes/` 下：含各型別屬性與 `.obsidian/types.json` 的筆記、有標籤樹的三篇、改名用的「待改名」與連到它的三篇、未連結提及用的純文字提及）。
4. `npx pnpm@9 tauri dev` 冒煙：改屬性後 git diff 只有那一行；改名後連入連結更新、Obsidian 開同一檔沒有壞；標籤樹數量正確；未連結提及一鍵連結。
5. 開 PR 到 `dev`：「Phase 2-2 知識庫整理：L5 屬性面板、L7 改名改寫連結、L6 筆記標籤、L4 未連結提及」。

## 8. 不在本階段

L8 local graph、`![[嵌入]]` 轉入、block ref、Bases、`.canvas`、標籤改名、`types.json` 寫入、Properties 的 Visible／Hidden、L7「記住選擇」設定、上游表格序列化器重排（另開小 PR）。
