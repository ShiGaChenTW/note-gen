---
title: "Correction: codex-echoink analysis (module count, /maintain, touches)"
author: Scottchen
date: 2026-10-25
branch: dev
cost: { minutes: 1, tokens: 1049 }
---

## Decided
- This corrects `2026-10-24-analyzing-codex-echoink-echoink-obsidian-plugin-scottchen.md` (do not edit that one). The full report now lives outside this repo: `/Users/scottchen/Documents/REA-Research/codex-echoink/` (REA-Research commits `eb77107`, `58e8ac4`).
- rea on the 12 MB `main.js`: the modules page has 86 nodes, all external references (`external:fs/promises`, etc.); the app's own 709 non-test modules were flattened by esbuild and produced 0 nodes. "0 modules" was wrong. "899 modules" counts tests; the figure is 709.
- `/maintain` is not "builds Wiki pages": the Agent calls `knowledge_maintain` in stages (decompose, plan, sections, write), one WAL per page, no production Ticket (synthetic `direct:<toolCallId>`). Existing pages accept only region-snapshot section patches, so untouched regions stay byte-identical; a region chosen with `replace` is replaced whole. A blocked WAL has no non-test unblock path.
- The release `main.js` is still not shown to be built from the cloned source (source HEAD `cf55c2db497c` = tag `2.8.4`).

## Tried and ruled out
- The old learning's "touches" list (`designs/*`, `.vscode/mcp.json`) is unrelated working-tree noise, not files this analysis touched.
- The first-pass `/maintain` description (preview, one Ticket for the batch, "re-run /maintain after recovery") was inferred and overturned by reading the main body; do not reuse it.

## Watch out
- Only `src/membership/`, `src/lifestyle/`, `src/english-diary/`, three `account-membership*.ts` and two finance skill files are PRO-licensed; everything else is MIT.
- Several risks (blocked WAL, `queuePersistenceLane` without catch, `abort()` early returns, 100 ms `diffChars` timeout, chat turns publishing `knowledge_maintain`) come from reading code only and were never reproduced.
