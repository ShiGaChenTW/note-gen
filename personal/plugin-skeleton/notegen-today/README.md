# NoteGen Today — 外掛骨架
Created: 2026-10-14 18:05 | Source: Claude (Fable 5.1) | 對應 note-gen @ 9859c6e

## 開工前已確認（原始碼）
| # | 問題 | 結果 |
|---|---|---|
| A | notes.list 時間戳 | `entries: {path, name, size, modifiedAt?}`，`modifiedAt` 為 optional（broker.ts:709）；`recursive`、`limit ≤ 1000`、`cursor` 分頁 |
| B | chat.read 用量 | 外掛 context 只有 `chat.setDraft`；沒有模型 / 用量 → 已不在範圍 |
| C | embedded-view 資料通道 | **沒有**。iframe 只收 `host.theme` / `host.settings` / terminal（plugin-sandboxed-view.tsx:118-163），且 `editor-tab` / 側欄不在 `embeddedViewLocations` 內 → 主畫面必須用宣告式 UI |
| D | 字型內嵌 | 不需要了（宣告式 UI 由主程式渲染，吃自訂 CSS） |
| E | workspace 範圍 | 整個 vault（Scott 2026-10-14 17:52） |
| F | CC 純函式 | `dailyNote.ts`、`taskScan.ts`、`taskLine.ts` 0 個 obsidian import，可直接搬；`dailyOps.ts` 有 1 個，需改寫寫入段 |
| G | 行事曆 / MCP | 外掛無 `mcp.*`；走「Agent 經 MCP 寫入 daily note 錨點段 → 外掛 notes.read」 |

## 執行契約（plugin-runtime.worker.ts）
- 入口必須 `export function activate(context)`，可選 `deactivate()`；在 QuickJS worker 內跑，無 DOM、無 fetch
- `context` 命名空間：`notes` `records` `storage.{device,workspace}` `ui.{views,showNotice,statusBar,openDialog}` `commands.handle` `workspace` `ai` `calendar.resolveDay` `editor` `attachments` `files` `clipboard` `log`
- 畫面：`ui.views.update(viewId, { blocks })`；block 型別見 ui-registry.ts:90-146（heading / text / key-value / list / table / actions / form / progress / callout / separator / tree / badge / layout / section / markdown / item-list / toolbar / tabs / empty）
- 命令必須先在 manifest `contributes.commands` 宣告，否則 `commands.handle` 丟 PermissionDenied

## 安裝（開發模式）
1. 設定 → 開發者模式 開啟
2. 外掛 → 安裝開發套件 → 選這個資料夾（`plugin.source === 'development'`，改檔自動 reload）
3. worker 的 moduleLoader 只認 `plugin:entry`（plugin-runtime.worker.ts:762）→ **不能 import 其他檔**；要用 CC 的正式解析器時，用 esbuild `--bundle --format=esm` 把 dailyNote.ts + taskScan.ts + entry 打成一個 `entry.js`

## 待做
- [ ] 以 esbuild bundle 取代 entry.js 內的 stub 解析器（CC dailyNote.ts / taskScan.ts）
- [ ] manifest 的 `apiVersion` / `minAppVersion` 對到你安裝的 NoteGen 版本（設定 → 關於）
- [ ] permissions 的 scope 名稱以 manifest.ts:43 的 enum 為準；若安裝時被拒，看 log 的 PermissionDenied 訊息調整
- [ ] 自訂 CSS 追加第 13 段：針對 `[data-plugin-view="tw.scottchen.notegen-today.main"]`（實際屬性名待查 plugin-view-surface.tsx）套卡片與琥珀樣式
