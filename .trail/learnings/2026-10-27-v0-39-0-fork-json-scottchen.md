---
title: "同步上游 v0.39.0：左側欄大綱頁籤接進 fork 啟動器、語系用 JSON 三方合併"
author: Scottchen
date: 2026-10-27
branch: sync/upstream-2026-10-27
id: l-ff838787
scope: repo
status: active
src: agent
touches:
  - pnpm-lock.yaml
---

## Decided
- 上游新增的左側欄 `outline` 頁籤（`outlinePlacement === 'sidebar'` 才出現）接進 fork 的啟動器版面（`left-sidebar.tsx`）：標籤用英文 `Outline`（#45 慣例，不用 `t('navigation.outline')`），`SidebarSearch` 的 `searchTab` 與右上角動作列都要排除 `outline`；`BUILT_IN_LEFT_SIDEBAR_TABS` 兩邊的頁籤全留。上游原本的 `motion.div` 動作列與 `MarkActions` 不採用（fork 已在 #46 拿掉左側記錄分頁）。
- `messages/*.json` 衝突不要手解，用 JSON 三方合併（base = `git merge-base dev upstream-dev`，逐 key 比較，同 key 兩邊都改才算衝突），再逐 key 驗證兩邊都沒遺失。這次六個語系都沒有同 key 衝突。
- `pnpm-lock.yaml` 取上游版（`--theirs`），再 `npx -y pnpm@10 install --lockfile-only` 補算；fork 只多 `vitest`／`jsdom`。
- 這次在獨立 worktree 同步（`~/.t3/worktrees/note-gen/sync-*`），不動主工作區的進行中分支。

## Tried and ruled out
- 上次 PR #25 補的 `NoInfer<T>` 型別修補，這次不用再帶：上游 v0.39.0 已自己加上。
- 語系 key 數量不一致（de 缺 110、pt-BR 缺 133 等）看起來像合併遺失，實際是同步前 `dev` 與上游就有的落差，數字合併前後相同。

## Watch out
- 上游把 `Highlight` 換成 `ColorHighlight`＋`TextColor`（`markdown-tokenizers.ts` 固定名單、`MARKDOWN_LEXER_VERSION` 升 2）。fork 沒動這個檔，所以不會衝突，但每次同步都要確認編輯器只註冊一次高亮擴充，且 `trySetMarkdownContent` 退回路徑仍先 `encodeFrontmatterForEditor`。
- vitest 整套偶發 1 個 unhandled error（`p2-1-wikilink-integration`，環境收掉後 ProseMirror 的計時器觸發 `document is not defined`），重跑就消失，單獨跑也沒有；不是同步造成。
- `trail check` 對上游程式碼與同步紀錄文字的「衝突」多是關鍵字誤判（tauri、description、ctrl、jsdom tab），在 PR 描述說明即可。
- 上游這版把 React 升到 19.2.3、zod 升到 4，`openai` 套件對 zod 的 peer 警告是上游既有的。
