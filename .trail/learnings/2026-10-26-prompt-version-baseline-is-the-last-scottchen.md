---
title: "prompt-version baseline is the last prompt-version commit, not HEAD; commit allows empty to mark confirmation"
author: Scottchen
date: 2026-10-26
branch: feat/56-confirm-prompt-version
cost: { minutes: 25, tokens: 2012 }
touches:
  - src-tauri/src/git_versions.rs
  - src/lib/git-versions/commands.ts
  - src/lib/git-versions/prompt-version-baseline.ts
  - src/lib/git-versions/prompt-version-diff.ts
---

## Decided
- #56 "確認為新版本" compares the live note content against the content at the *latest prompt-version-kind commit* for that path (`getLatestPromptVersionBaseline` in `src/lib/git-versions/prompt-version-baseline.ts`), never against HEAD. Auto-snapshot can commit the same edit to HEAD first (kind=auto-snapshot); the banner must still show "unconfirmed" until a prompt-version commit exists with that exact content.
- Added `allow_empty: bool` to `git_version_commit` (Rust `commit_internal`) and to the TS `commitGitVersion(..., allowEmpty = false)`. When auto-snapshot already caught the edit up to HEAD, staging just that path produces a tree identical to HEAD's tree, so the normal "unchanged -> return None, no empty commit" guard would silently no-op the user's explicit confirmation. The confirm flow always passes `allowEmpty: true`; every other caller (auto-snapshot, #52 default) keeps the old no-op-on-unchanged behavior.
- Commits made with explicit `paths` (prompt versions, #54 restores) carry one `NoteGen-Version-Path: <path>` trailer per target path (`format_commit_message` / `trailer_paths` in `git_versions.rs`). `commit_touches_path` treats such a commit as belonging only to those paths, skipping the tree-diff check. Reason: an `allow_empty` prompt-version commit has zero diff vs its parent, so a diff-based check would hide it from `listGitVersionLog({ path })`, breaking the baseline lookup and the #54 history panel. Commits without path trailers (auto-snapshot, foreign commits) still use the diff-based check.

## Tried and ruled out
- First version of the fix said "a prompt-version commit touches the path whenever the path exists in its tree". Wrong: every commit is a full vault snapshot, so confirming prompt A put that commit into every note's history and moved prompt B's baseline (B's unconfirmed-changes banner vanished). Replaced by the path trailer.
- Considered amending/retagging the existing HEAD commit (created by auto-snapshot) into a prompt-version commit instead of creating a new empty one. Rejected: rewriting history is riskier (could affect anything referencing that commit id) and more complex than allowing an empty commit purely for this one path.

## Watch out
- If #54/#55 add more kinds or more `git_version_commit` call sites, remember `allow_empty` defaults to `false` — only the "confirm as new version" flow should pass `true`. Any new call site that passes `allowEmpty: true` must also pass explicit `paths`, or the empty commit has no path trailer and vanishes from path-filtered log queries.
