---
title: "記錄改由 Inbox 頁處理：左側欄不再有記錄清單，「已整理」只存在本機"
author: Scottchen
date: 2026-10-26
branch: feat/46-inbox-page
cost: { minutes: 53, tokens: 443234 }
id: l-f96027db
scope: repo
status: active
src: agent
touches:
  - GLOSSARY.md
  - messages/de.json
  - messages/en.json
  - messages/ja.json
  - messages/pt-BR.json
  - messages/zh-TW.json
  - messages/zh.json
  - src/app/core/main/daily/daily-calendar.tsx
  - src/app/core/main/daily/sidebar-calendar.tsx
  - src/app/core/main/left-sidebar.tsx
---

## Decided
- #46：左側欄下半部拿掉記錄分頁（NoteSidebar／MarkActions 不再掛在 `left-sidebar.tsx`），記錄改在 Inbox 頁（`src/app/core/main/inbox/inbox-screen.tsx`）整理。Inbox 頁做法同首頁：蓋在編輯器上、與首頁互斥（`stores/inbox.ts` 訂閱 `useHomeStore`）。
- 原本會「切到記錄分頁」的地方：快速記錄完成不切換畫面，沿用 `use-record-completion.tsx` 原有的「記錄已保存 · 查看」提示，「查看」改呼叫 `openRecordInInbox`；搜尋結果、對話來源改呼叫 `openRecordInInbox`；系統匣記錄動作只回到主畫面；`handleRecordComplete` 桌面端是空的。
- 「已整理」放在本機表 `record_processed`（`src/db/record-processed.ts`），刻意不加到 `marks` 表，避免改動記錄的同步格式；代價是換裝置不會同步。
- 首頁／Inbox 頁的 `--home-left` 改成量 `[data-left-sidebar]` 的實際右緣（`page.tsx`）；面板 `onResize` 的 `inPixels` 不含外框，用它會把側欄右側切掉約 20px。

## Watch out
- `deleteMarks`／`restoreMarks` 會把 `createdAt` 改成現在（上游行為），所以刪掉再還原的記錄會變成「新的」，不算積壓。
- cua-driver 對「整列是 role=button、裡面有 Radix Checkbox」的列做 AX press 或背景點擊，會勾到勾選框；Inbox 的列因此把「展開」做成獨立的 `<button>`。
- dev 版與正式版共用 `~/Library/Application Support/tw.scottchen.NoteGen/note.db`，實測記錄前先備份，結束後還原。
