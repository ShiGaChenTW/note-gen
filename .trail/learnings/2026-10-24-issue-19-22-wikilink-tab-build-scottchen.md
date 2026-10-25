---
title: "Issue #19–#22 根因：檔案樹排序預設、wikilink 兩下才開、關聯圖 tab、正式 build 索引量測"
author: Scottchen
date: 2026-10-24
branch: fix/issues-19-22
cost: { minutes: 76, tokens: 789867 }
touches:
  - personal/FORK-CHANGES.md
  - ".vscode/mcp.json"
  - designs/frontmatter-card/prototype.html
  - designs/graft/.cache/session/e771aad2-6684-421b-86d6-352cb65be838.json
  - designs/graft/.cache/telemetry-repo-id.json
  - designs/login.pen
  - designs/login.png
  - designs/notegen-editor-v1.fig
  - src/app/core/main/editor/markdown/wikilink-extension.ts
  - src/lib/vault-index/service.ts
---

## Decided
- #19 檔案樹沒排序不是讀目錄順序的 bug，是上游 `article.ts` 的 `sortType` 初始值 `'none'`（只把資料夾排前）；所有讀樹的路徑（loadFileTree、loadCollapsibleFiles、setFileTree）都已過 `sortFileTree`，所以只改初始值為 `'name'` 一行即可，使用者選過的排序仍由 initSortSettings 從 store 讀回。
- #20 wikilink 要點兩下：編輯器有焦點時 mousedown 預設動作把 DOM 游標放進 inline atom 的文字，ProseMirror `selectionFromDOM` 把「落在 atom 內部的 collapsed selection」轉成 NodeSelection（黃框），該輪 `handleClickOn` 拿不到。修法是在 plugin view 對 `view.dom` 加 capture 階段的 `mousedown`（preventDefault＋stopPropagation）與 `click`（開啟），不碰 `handleClickOn`。
- #22 正式 build 看不到 console：索引服務改成每次掃描／增量更新後寫 `vault-index/<hash>.stats.json`（含 `sinceLoadMs`），用檔案量效能。快取檔名雜湊是 djb2 base36，測試 vault 對應 `1gy1zs6`。

## Tried and ruled out
- #20 以為是上游 tiptap-editor 的 `handleDOMEvents`／capture mousedown 吞掉事件：pointerdown 回 false、`handleModifiedMouseDown` 只處理有 href 的 `<a>`，都不是。
- #21 關聯圖 tab 點不到：程式層找不到原因（`Waypoints` 圖示存在、ui-registry 不驗 key、既有 jsdom 測試 mousedown 能切到 `@graph`、右側面板沒有覆蓋元素）。最可能是 CGEvent 自動化時 ctrl 修飾鍵卡住（Radix TabsTrigger 對 ctrlKey 的 mousedown 不切換），需 Scott 手動確認。

## Watch out
- jsdom 跑 ProseMirror 的滑鼠事件會因沒有 `elementFromPoint`／`getClientRects`／`getBoundingClientRect`（含 Text node）而拋 unhandled error，測試裡要先 stub。
- `tauri build` 用 `npx pnpm@9 tauri build`，產物在 `src-tauri/target/release/bundle/macos/`，可直接 `open` 不必覆蓋 /Applications；量測前先把舊的正式版關掉。
