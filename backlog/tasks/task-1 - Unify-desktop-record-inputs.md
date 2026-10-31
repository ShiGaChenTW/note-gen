---
id: TASK-1
title: Unify desktop record inputs
status: In Progress
assignee:
  - '@scottchen'
created_date: '2026-10-31T03:49:00Z'
updated_date: '2026-10-31T15:06:00Z'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The desktop title bar and record header expose up to eight independently implemented record controls. The approved A design uses one compact entry point, where users type or paste first and explicitly expand for detailed fields while preserving existing record types and save behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Desktop title bar and record header show one unified record entry point instead of eight independent buttons
- [ ] #2 The dialog supports automatic text versus single HTTP(S) link classification and manual Cmd/Ctrl+1 through Cmd/Ctrl+8 selection
- [x] #3 The dialog exposes attachment, recording, and screenshot actions without discarding the current draft
- [x] #4 Text, link, todo, and prompt-draft records persist with their existing database contracts and completion behavior
- [ ] #5 Existing desktop shortcut and tray actions open the unified dialog with the requested record type
- [ ] #6 Mobile record controls remain functional
- [x] #7 Focused automated tests cover classification and shortcut selection, and project verification passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-31 由 Claude 接手（Codex 第 10 輪撞用量上限中止）。Review 後修正：待辦保留共用草稿（resolveUnifiedTodoDraft）；連結補 https 並恢復部分擷取提示；媒體動作關視窗但保留草稿；新增檔案與音訊檔入口（toolbar-shortcut-recording-file）；入口顯示錄音時長與停止；接回 onboarding prefill／create-record 完成事件；來源欄只在 prompt-draft 顯示；字串進 6 語系 i18n；host 只留媒體控制項並還原 control-text；移除無人使用的 draggable-toolbar-item 與 toolbar-shortcuts。驗證：tsc、eslint、vitest 1042/1042 通過。未驗證：桌面實機互動（Mac 鎖定，鎖定時 WebView 不繪製，截圖全黑無法判斷）。/Applications 內仍是修正前的版本。

2026-10-31 實機驗收（隔離 identifier tw.scottchen.NoteGen.accept）。通過並寫入 DB：文字（滑鼠存檔與 Cmd+Enter）、待辦（第一行為標題、其餘為說明）、prompt-draft（含來源網址）、連結（Cmd+1、自動判斷、裸網域補 https、404 時顯示部分擷取提示）、圖片、檔案、音訊檔、麥克風錄音（入口顯示時長與停止）。草稿在媒體流程後保留。Cmd+1 到 Cmd+8 在 ABC 與注音下都能選到正確類型（AC2 未勾，見下）。新手引導範例帶入，存檔後 create-record 完成。截圖只驗到開啟視窗，未按儲存（畫面含真實內容，且會送辨識）。實測發現並修正：注音下 event.key 不是數字，改同時比對 event.code。Cmd+0 在這台 Mac 上被全域熱鍵攔走（最小 WKWebView 視窗同樣收不到），非 app 問題。mark-header 在桌面沒有掛載點，AC1 以標題列為準。未驗證：系統匣動作（AC5，與正式版的系統匣無法區分）、行動版（AC6）、Windows/Linux（AC2 寫 Cmd/Ctrl，實作沿用 Alt，待決定）。

2026-10-31 系統匣驗證（正式版已關閉，只有測試版的系統匣）：文本、录音、插圖、連結、文件、待辦都會開統一視窗並選好類型。系統匣「截圖」走 Rust start_desktop_screenshot，不開統一視窗，未改動也未在此次驗證，所以 AC5 未勾。新版 2063ff0b 已安裝到 /Applications 並確認主畫面正常顯示。
<!-- SECTION:NOTES:END -->
