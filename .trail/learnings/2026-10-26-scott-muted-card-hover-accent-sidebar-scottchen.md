---
title: Scott 的深色主題裡 --muted 與 --card 同色：hover 要用 accent／sidebar-accent
author: Scottchen
date: 2026-10-26
branch: feat/sidebar-inbox-ui-polish
cost: { minutes: 1, tokens: 1296 }
id: l-68b9ce17
scope: repo
status: active
src: agent
touches:
  - personal/notegen-obsidian-baseline.css
---

## Decided
左側欄可點的列用 `src/app/core/main/sidebar-row.ts` 的 `SIDEBAR_ROW`／`SIDEBAR_ROW_ACTIVE`（sidebar-accent 色票，與檔案樹 `.file-manager-item` 一致），卡片底上的列用 `hover:bg-accent`，because Scott 的自訂 CSS（`personal/notegen-obsidian-baseline.css`）讓 `--muted` 與 `--card` 同色，放在 `bg-card` 上的 `hover:bg-muted` 會完全看不出 hover。
## Watch out
- 功能入口 active 用底色加圖示 `text-sidebar-primary`、不加左側色條，because Scott 的自訂 CSS 特地拿掉了檔案樹 active 列的色條。
- 左側欄字串放頂層 `leftSidebar` 命名空間，otherwise `note-tags-sidebar.test.ts` 會失敗（它要求每個語系 `navigation` 最後一個 key 是 `noteTags`）。
- 正式版 NoteGen 開著時，`tauri dev` 的視窗會因單一實例立刻退出，要先關正式版才能實機看畫面。
