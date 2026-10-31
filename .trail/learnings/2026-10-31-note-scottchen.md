---
title: "桌面記錄入口分三條路：統一視窗、原生截圖、快速記錄小視窗"
author: Scottchen
date: 2026-10-31
branch: docs/unified-input-button-evaluation
id: l-a997b256
scope: repo
status: active
src: agent
touches:
  - backlog/tasks/task-1 - Unify-desktop-record-inputs.md
  - src/lib/shortcut/quick-record-text.ts
---

## Decided
統一視窗（src/app/core/main/mark/unified-record-dialog.tsx）沒有接管所有桌面入口。⌘1–8 和系統匣的文字類動作會開它；系統匣截圖與全域 ⌘⇧S 走 start_desktop_screenshot（src-tauri/src/tray.rs、src/stores/shortcut.ts、src/components/desktop-screenshot-bridge.tsx）；全域 ⌘⇧T 發 quickRecordText，開 src/lib/shortcut/quick-record-text.ts 的獨立小視窗。統一視窗的截圖按鈕則是 toolbar-shortcut-scan → control-scan.tsx 的舊視窗截圖面板，和框選畫面是兩套流程。

## Watch out
quickRecordText 和 quickRecordTextHandler 是不同事件，後者才會開統一視窗。
⌘⇧T 的小視窗是另一個視窗，對主視窗截圖看不到它，容易誤判成快捷鍵沒反應。它還會自動帶入剪貼簿文字。
截圖流程在 enableImageRecognition 開啟且有 primaryModel 時，會把本機 OCR 文字送給模型產生摘要；用真實畫面驗收前先在隔離 profile 關掉辨識。
