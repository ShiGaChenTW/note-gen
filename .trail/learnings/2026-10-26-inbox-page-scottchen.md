---
title: "首頁／Inbox 頁的外框改量工作區面板（--page-*），不再只量側欄右緣"
author: Scottchen
date: 2026-10-26
branch: feat/ui-consistency
cost: { minutes: 15, tokens: 192895 }
id: l-2fd7ee01
scope: repo
status: active
src: agent
touches:
  - src/app/core/main/page-ui.tsx
  - src/lib/time-format.ts
  - src/lib/inbox/use-inbox-pending.ts
  - src/app/core/main/page.tsx
---

## Decided
- `page.tsx` 的 `measurePageBox` 量第一個看得到的工作區面板（左緣、上下緣、圓角）加上面板群組的內距，寫進 `--page-top/right/bottom/left/radius`；`page-ui.tsx` 的 `PageSurface` 用這些變數。取代原本只量 `[data-left-sidebar]` 右緣的 `--home-left`，because 自訂 CSS 把面板做成有內距、圓角的卡片時，首頁和 Inbox 頁只量側欄會變成平貼，跟工作區對不齊。
- 首頁、Inbox 頁共用 `page-ui.tsx` 的 `PageHeader`／`Count`／`EmptyState`，清單時間用 `src/lib/time-format.ts`（`hourCycle: 'h23'`），because 繁中的 `hour: '2-digit'` 會顯示「清晨07:11」這種 12 小時制，跟首頁的 24 小時制不一致。
- 左側欄 Inbox 徽章用 `useInboxPendingCount`（未整理記錄＋Inbox 資料夾筆記），because 它要跟首頁「Inbox 有 N 則待整理」的數字一樣。
## Watch out
- 用 cua-driver 在背景截 tauri dev 的圖時，帶 `transition-colors` 的元素會停在漸變起點（例如選中底色留在上一個項目上），狀態列也可能看起來文字重疊，because WebKit 對背景視窗不跑動畫影格。截圖前要先把視窗切到前景（System Events 的 `set frontmost`），不要誤當成 bug 去修。
- `Count` 不要用 `bg-muted`：Scott 的深色主題裡 `--muted` 等於 `--card`，放在 `bg-card` 上會看不到圓底。
