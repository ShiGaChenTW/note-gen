---
title: "查 fork 進度要指定 -R ShiGaChenTW/note-gen"
author: Scottchen
date: 2026-10-20
branch: dev
cost: { minutes: 9, tokens: 82305 }
---

## Decided
查 PR／Issue 進度一律用 `gh issue list -R ShiGaChenTW/note-gen`、`gh pr list -R ShiGaChenTW/note-gen`。

## Tried and ruled out
不加 -R 的 `gh issue list`／`gh pr list` 會回上游 codexu/note-gen 的 PR 與 Issue（#1298 等），與 fork 試用期無關。

## Watch out
Fork 的試用期缺口是 Issue #15–#22；remote 有 origin（fork）與 upstream 兩個，gh 預設解析到上游。
