---
title: "自訂 CSS 的 --ob-* 變數要在 :root 給淺色值，不能只寫在 .dark"
author: Scottchen
date: 2026-10-26
branch: fix/69-custom-css-light-theme
cost: { minutes: 34, tokens: 220660 }
id: l-fbc62c53
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
  - src/app/core/main/daily/sidebar-calendar.tsx
  - src/app/core/main/home/cards/needs-list.tsx
  - src/app/core/main/home/cards/recent-card.tsx
  - src/app/core/main/home/cards/report-card.tsx
---

## Decided
`personal/notegen-obsidian-baseline.css` 的 `--ob-shell`／`--ob-faint` 等變數，`:root` 放淺色值，`:root.dark, .dark` 再覆蓋成深色。原因：標題列、狀態列、面板外框都用 `var(--ob-shell, #161616)`，只在 `.dark` 定義的話，淺色主題會吃到深色的 fallback，畫面外圍變成黑框。

## Watch out
- 自訂 CSS 裡別寫死深色值（例如表格標題列原本是 `#2e2e2e`），要用主題變數。
- 用 `--accent`，不要用 `--muted`：深色主題裡 `--muted` 跟 `--card` 同色，放在卡片上會看不出來。
- 換自訂 CSS 前，要先確認正式版是 #64 之後打包的（有 `src/app/fork-theme.css`）。舊版正式版沒有內建色票，CSS 精簡掉色票後會退回上游預設。
- 直接改 `store.json` 的 `customCss` 時要先關掉 app，不然 app 會用記憶體裡的舊值寫回去。
