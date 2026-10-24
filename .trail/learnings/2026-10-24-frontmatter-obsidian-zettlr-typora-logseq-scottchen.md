---
title: Frontmatter 編輯/展示的市場調研（Obsidian/Zettlr/Typora/Logseq）
author: Scottchen
date: 2026-10-24
branch: dev
cost: { minutes: 3, tokens: 61175 }
touches:
  - ".vscode/mcp.json"
  - designs/graft/.cache/session/e771aad2-6684-421b-86d6-352cb65be838.json
  - designs/graft/.cache/telemetry-repo-id.json
  - designs/login.pen
  - designs/login.png
  - designs/notegen-editor-v1.fig
---

## Decided
- 「formatter」解讀為 YAML frontmatter（屬性區塊）。結論：主流是「表單＋原始碼可切換」（Obsidian）；Zettlr/Typora 則當程式碼高亮、不結構化。
- 建議保守做法：原文顯示＋語法高亮＋錯誤提示；若做表單，只改動被編輯的那一行，其餘行與行尾註解原樣保留，巢狀物件退回唯讀原始碼。

## Tried and ruled out
- 只做了網路搜尋，未實機試用。MarkText 搜不到資料；Typora 編輯器內的顯示方式查不到。
- Obsidian 表單式編輯不可照搬：論壇回報它解析成物件再寫回，會洗掉格式（flow 轉 block）；巢狀 YAML 只顯示成 unknown 型別。此成因是使用者推測，非官方。

## Watch out
- 行尾註解（如 `# 行尾註解要留著`）在表單式編輯最容易遺失，與 Issue #14 同一類問題。
