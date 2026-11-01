---
title: "同步上游 v0.39.2：上游刪除 zh-TW 語系檔，直接合併會讓繁中介面變英文"
author: Scottchen
date: 2026-11-01
branch: dev
cost: { minutes: 11, tokens: 234119 }
id: l-23b7cc24
scope: repo
status: active
src: agent
touches:
  - src/i18n/config.ts
  - src/app/core/setting/ai/page.tsx
  - src/app/core/main/home/home-screen.tsx
  - src/app/core/main/home/cards/capture-bar.tsx
  - src/app/core/main/home/cards/needs-list.tsx
  - src/app/core/main/home/cards/recent-card.tsx
  - src/app/core/main/home/cards/signals-card.tsx
  - src/app/core/main/home/cards/footprint-card.tsx
  - src/app/core/main/home/cards/tasks-card.tsx
  - src/app/core/main/inbox/inbox-screen.tsx
---

## Decided
試合併 origin/dev + upstream/dev（8088a60f 把非中英語言改成外掛）時，messages/zh-TW.json 必須留下，並在 src/i18n/config.ts 的 SUPPORTED_LOCALES 與 loaders 補回 zh-TW，language.tsx 也要補選項。上游的 loadMessagesWithFallback 對 zh 以外一律用 en 蓋 zh，所以只留 JSON 不改 config 會顯示英文。zh-TW 的備援應接 zh，不要接 en，上游新 key 才不會冒出英文。
## Tried and ruled out
`next build` 直接跑會在 src/app/core/setting/ai/page.tsx 報 invalid default export；該檔與上游基準相同，不是合併造成。驗證要用 `pnpm build`（--turbopack 加前置 worker 建置），這條才通過。
## Watch out
tiptap-editor.tsx 衝突時，上游刪掉 setEditorContentWithoutUndo，並把歷史處理搬進 trySetMarkdownContent；必須保留 encodeFrontmatterForEditor(content)，否則 frontmatter 的 --- 會變分隔線。刪掉 de/ja/pt-BR 會讓 5 個 fork 測試檔的 import 失敗（backlinks-panel、local-graph-panel、link-rewrite-prompt、note-tags-sidebar、properties-panel）。
