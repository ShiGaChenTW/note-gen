---
title: "新增 Mark 類型要找三個獨立的字面量型別與一個同步驗證白名單"
author: Scottchen
date: 2026-10-26
branch: feat/55-prompt-draft-organize
cost: { minutes: 46, tokens: 538272 }
touches:
  - messages/de.json
  - messages/en.json
  - messages/ja.json
  - messages/pt-BR.json
  - messages/zh-TW.json
  - messages/zh.json
  - src/app/core/main/inbox/inbox-screen.tsx
  - src/app/core/main/mark/mark-detail-panel.tsx
  - src/app/core/main/mark/mark-filters.ts
  - src/app/core/main/mark/mark-header.tsx
---

## Decided
- 新增 `Mark['type']` 的新成員（這次是 #55 的 `prompt-draft`）時，`db/marks.ts` 改了以後要用
  `tsc --noEmit` 把所有編譯錯誤跑出來逐一修，比手動 grep 全專案快很多（這次跑出約 10 個檔案）。
- 但 `tsc` 抓不到兩類風險，要手動檢查：
  1. 不是從 `Mark['type']` 派生、而是自己重複宣告一樣字面量聯集的型別——這次是
     `src/lib/sync/record-assets.ts` 的 `RecordAssetMark.type`、`src/types/canvas.ts` 的
     `recordType`。這些型別不跟著 `Mark['type']` 變動，要手動加新成員，不加也不會噴錯，只是執行時
     在那條分支被當作「沒有本地附件／沒有對應圖示」處理（不會壞，但功能缺角）。
  2. 執行時的 allowlist／`Set`，TypeScript 完全看不出少了什麼——`src/db/record-snapshot.ts` 的
     `recordTypes`（跨裝置同步快照驗證）、`src/app/core/main/mark/mark-filters.ts` 的
     `VALID_TYPES`。這兩個是真的會壞：快照驗證漏了新類型，整批同步只要混進一筆新類型記錄就會
     `throw`、「本機記錄沒有被取代」；篩選器漏了就是使用者勾選新類型後重開 app 篩選器悄悄失效。
     這次補了這兩處並在 `src/db/record-snapshot.test.ts` 新增了回歸測試。
- `@notegen/plugin-api`（npm 套件，不是這個 repo 的原始碼）的 `PluginRecord.type` 和
  `recordType` target 是對外的外部合約，不能直接塞新的字面量進去。做法：對外曝光時把新類型「降級」
  成語意最接近的既有類型（`prompt-draft` → `text`，因為兩者都是純文字、沒有附件），見
  `src/lib/plugins/records.ts` 的 `snapshot()`；`mark-detail-panel.tsx` 的 `pluginRecordTarget`
  則是乾脆對這個新類型回傳 `undefined`，不給外掛 target 資訊，兩種處理都合理，依使用情境選。

## Tried and ruled out
- 原本考慮把「把 `[主題]`／`<topic>`／`{topic}`／`$TOPIC` 統一成 `{{...}}`」這個變數統一偵測交給
  AI 判斷要替換哪些字元，後來改成純規則的正則偵測（`variable-unification.ts`，不碰 AI）。原因：
  「原文除勾選的變數替換外完全不變」是這張票（#55）明確要測試的不變量，AI 輸出不保證逐字元穩定，
  規則式偵測才能寫出可靠的單元測試鎖住這個保證；AI 只負責描述偵測到的變數用途，不參與決定替換哪些
  字元。

## Watch out
- i18n 字串裡要寫字面的 `{{...}}` 時，`next-intl`／ICU MessageFormat 會把裸的 `{` 當成參數起點，
  要包在單引號裡escape：`'{{...}}'`（兩邊都是單引號字元，不是跳脫符號）。這個專案已有前例
  （`messages/*.json` 的 `templatesDesc`），照抄那個寫法就對了，別直接寫 `"{{...}}"`。
