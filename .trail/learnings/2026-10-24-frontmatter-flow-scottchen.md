---
title: frontmatter 屬性卡片實作：單一存檔路徑與 flow 清單保留
author: Scottchen
date: 2026-10-24
branch: feat/frontmatter-card
cost: { minutes: 25, tokens: 544498 }
touches:
  - messages/de.json
  - messages/en.json
  - messages/ja.json
  - messages/pt-BR.json
  - messages/zh-TW.json
  - messages/zh.json
  - src/app/core/main/editor/markdown/frontmatter-extension.ts
  - src/app/core/main/editor/markdown/tiptap-editor.tsx
  - src/app/core/main/properties/properties-model.ts
  - src/app/core/main/properties/properties-panel.test.ts
---

## Decided
- 編輯區頂端的 frontmatter 改成 React NodeView 卡片（frontmatter-card-view.tsx）。卡片只 updateAttributes({raw})，磁碟寫入交給編輯器既有防抖存檔；不要呼叫 rewriteNote（會與 hasQueuedSave 競態、重載編輯器）。
- applyFrontmatterEditToBlock(block, edit) 以區塊原文為輸入；刪光最後一個屬性回傳空字串，呼叫端 deleteNode()。
- flow 清單（tags: [a, b]）編輯後維持 flow 寫法，不再改成逐行；舊測試的預期已更新。
- Scott 的決定：範本在設定頁維護（settings.editor.frontmatter）、{{title}} 預填檔名、卡片收合狀態全域一個（frontmatterCollapsed）。

## Tried and ruled out
- codex 額度用完時改用 grok 審查：--permission-mode auto 加唯讀 --allow 能跑完，但約 10 分鐘。
- tauri dev 視窗截圖需要 Herdr 的螢幕錄製權限；沒授權時 screencapture 會報 could not create image，只能請使用者目視驗收。

## Watch out
- vitest 只收 tests/**/*.test.ts 與 src/**/*.test.ts，不收 .tsx；測 React 用 React.createElement，mock 的 store 要用 await import 動態載入被測模組。
- pnpm 指令要加 pnpm_config_verify_deps_before_run=false。
- 新增 i18n key 要同步六個語系（properties 的 key 清單有測試鎖住）。
