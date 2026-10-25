---
title: Agent skills 設定放 AGENTS.md 與 docs/agents/，.gitignore 需開例外
author: Scottchen
date: 2026-10-25
branch: docs/codex-echoink-learnings
cost: { minutes: 1, tokens: 0 }
id: l-c09b6198
scope: repo
status: active
src: agent
---

## Decided
- 此 repo 用 `AGENTS.md`（不是 CLAUDE.md）放 `## Agent skills` 區塊，because 使用者選它：較通用，codex 等其他代理也會讀。
- issue tracker = GitHub fork（ShiGaChenTW/note-gen），triage 標籤用預設五個；設定在 `docs/agents/{issue-tracker,triage-labels,domain}.md`，單一 context。
- `gh` 一律加 `--repo ShiGaChenTW/note-gen`, otherwise 可能誤對 upstream（codexu/note-gen）開 issue/PR。

## Tried and ruled out
- CLAUDE.md：使用者未選。
- 維持 docs/ 全忽略：because 設定與 ADR 不進版控、worktree 要手動複製，故改開例外。

## Watch out
- `.gitignore` 有三條擋路規則：`docs/*`、`/docs/*/*`、`/*.md`。只加 `!docs/agents/` 不夠，otherwise 檔案仍被忽略；必須同時有 `!/docs/agents/*`、`!/docs/adr/*` 和 `!AGENTS.md`，改完用 `git check-ignore -v` 驗證。
