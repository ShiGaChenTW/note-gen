---
title: "合併 PR 到 dev 後，清掉 worktree 與分支"
author: Scottchen
date: 2026-10-20
standing: true
---

## Decided
PR 都合併進 `dev`。合併完成後，一併清掉已併入的 worktree（如 `note-gen-wt/*`）與本機及遠端分支。這是每次合併 PR 都會附帶的要求，不用再問。

## Watch out
只清已併入的分支和 worktree。尚未併入的過期 worktree 要先列出來，不要直接刪。

_Told to Claude in 3 past sessions here, most recently on Oct 19._
