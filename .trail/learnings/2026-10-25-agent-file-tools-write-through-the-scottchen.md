---
title: "Agent file tools write through the live editor when the file is open, so disk lags behind"
author: Scottchen
date: 2026-10-25
branch: feat/30-task-center
id: l-ac0df6bf
scope: repo
status: active
src: agent
touches:
  - src/lib/agent/tool-registry.ts
  - src/lib/agent-tasks/index.ts
---

## Decided
- `executeUpdateFileWithChange` in `src/lib/agent/tool-registry.ts` routes to the editor (`replaceEditorContentTool`) when `targetsActiveEditor(filePath)`; the file reaches disk only after the editor's debounced save. Anything that re-reads disk right after a tool write (the #30 draft review in `src/lib/agent-tasks/index.ts`) must wait until disk matches (`waitForDisk`, up to 3 s) or it sees stale content and flags false conflicts.
- Background tasks (#30) keep vault writes as drafts; a task that renames then edits needs the draft overlay to resolve move/copy targets (`readThroughDrafts`), otherwise the model cannot find the renamed file and silently skips the edit.

## Tried and ruled out
- `tauri dev` inside a `note-gen-wt/*` worktree whose `node_modules` is a symlink to the main repo: Turbopack panics with "Next.js package not found". Run `npx next dev -p 3456` (webpack) first, then `tauri dev --config '{"build":{"beforeDevCommand":""}}'` with `CARGO_TARGET_DIR` pointing at the main repo's `src-tauri/target` (34 s incremental build instead of a full one).

## Watch out
- cua-driver: background `type_text` without an `element_token` lands in the focused editor and autosaves into the daily note; always target the chat `AXTextArea` by token inside one `run_script` (CLI tokens do not survive between calls).
