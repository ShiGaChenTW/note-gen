---
title: "首頁蓋在編輯器上時，編輯器的浮動選單與自動收起首頁的判斷"
author: Scottchen
date: 2026-10-25
branch: feat/home-keep-left-sidebar
cost: { minutes: 12, tokens: 109433 }
id: l-9bdbe6b4
scope: repo
status: active
src: agent
touches:
  - messages/de.json
  - messages/en.json
  - messages/ja.json
  - messages/pt-BR.json
  - messages/zh-TW.json
  - messages/zh.json
  - personal/FORK-CHANGES.md
  - src/app/core/main/agent-tasks/agent-tasks-sheet.tsx
  - src/app/core/main/home/cards/needs-list.tsx
---

## Decided
- `home/home-service.tsx`：首頁打開時讓 `.ProseMirror` 失焦，因為編輯器的浮動選單（選取文字、表格）是 portal 到 body 的 `fixed z-50`，比首頁的 `z-30` 高；`table-context-toolbar.tsx` 另外在首頁可見時直接不渲染（它不看焦點）。
- 從左側欄開檔才收起首頁：記錄最近一次碰到 `[data-left-sidebar]` 的時間，3 秒內 `activeFilePath`／`activeTabId` 變了才 hide，because 啟動時還原分頁、自動開今日日記也會改 activeFilePath，直接訂閱會讓首頁一開就被收掉。
## Watch out
- 只聽 `pointerdown` 時，cua-driver 的背景點擊收不到；要一起聽 `mousedown`、`click`、`keydown`。
- 點資料夾會開「資料夾分頁」，也算開檔，首頁會收起。
