---
title: "統一記錄視窗：媒體流程沿用隱藏的舊控制項，桌面快捷鍵要比對 event.code"
author: Scottchen
date: 2026-10-31
branch: docs/unified-input-button-evaluation
id: l-8fe374e1
scope: repo
status: active
src: agent
touches:
  - src/app/core/main/mark/desktop-record-controls.tsx
---

## Decided
- `src/app/core/main/mark/desktop-record-controls.tsx` 隱藏掛載 ControlRecording、ControlScan、ControlImage、ControlFile，`unified-record-dialog.tsx` 用 `toolbar-shortcut-*` 事件呼叫它們，because 原生檔案、麥克風、截圖流程都在這些元件裡，重寫容易漏掉行為。
- 媒體動作會關閉視窗但不清草稿，because 它們有自己的原生視窗，結束後使用者還要接著寫。
- `resolveUnifiedRecordShortcut` 優先看 `event.code` 的 `DigitN`，because 注音下 `event.key` 不是數字，否則 Cmd+1 到 Cmd+8 會沒有反應。

## Watch out
- `onboarding-spotlight.tsx` 的遮罩蓋滿全畫面，點「+」的第一下只會關遮罩，第二下才開視窗。這是原本就有的行為，不是統一視窗造成的。
- `mark-header.tsx` 的入口在桌面沒有掛載點，看得到的入口只有標題列。
- 系統匣的「截圖」走 Rust 的 `start_desktop_screenshot`，不經過 `unified-record-open`，所以測系統匣時它的結果和其他項目不同。
