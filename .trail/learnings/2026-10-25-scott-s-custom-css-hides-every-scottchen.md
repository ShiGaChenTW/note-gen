---
title: "Scott's custom CSS hides every dialog description; put essential hints in labels or body"
author: Scottchen
date: 2026-10-25
branch: feat/33-conversation-summary
id: l-748ca8f5
scope: repo
status: active
src: agent
touches:
  - personal/FORK-CHANGES.md
  - src/app/core/main/conversation-summary/summary-dialog.tsx
  - personal/notegen-obsidian-baseline.css
---

## Decided
- `personal/notegen-obsidian-baseline.css` (pasted into Settings → custom CSS, stored in `store.json` `customCss`) contains `[data-slot="dialog-description"] { display: none !important; }` on purpose. Any `<DialogDescription>` text is invisible in Scott's app, so fork dialogs (e.g. `src/app/core/main/conversation-summary/summary-dialog.tsx`, `home/cards/needs-list.tsx` HandoffDialog) must carry essential meaning in the title, button labels or visible body text, not only in the description.

## Tried and ruled out
- Debugging a "missing" description as a flex-layout squeeze: the dialog layout was fine; the rule above hides it.

## Watch out
- Screenshots from the dev app use the same app-data dir as the installed app, so they include this custom CSS; a plain browser or fresh profile will show descriptions.
