---
title: Home hotkey must match the physical key; injected modifiers can stick in WebKit
author: Scottchen
date: 2026-10-25
branch: feat/31-home
id: l-145542f9
scope: repo
status: active
src: agent
touches:
  - src/app/core/main/home/home-service.tsx
---

## Decided
- `src/app/core/main/home/home-service.tsx` matches ⌘⇧H by `event.code === 'KeyH'` OR `event.key` OR `keyCode 72`. With the Zhuyin (注音) input source active, plain keys arrive with `key` set to bopomofo (x → ㄌ), so a shortcut must not rely on `event.key` alone.
- The Home overlay lives inside `/core/main` (`absolute inset-x-0 top-0 bottom-7` over the panels, status bar stays visible) instead of a new route, so toggling never unmounts the editor workspace.

## Watch out
- cua-driver background `hotkey` with cmd can leave WebKit believing Meta is still down: the toolbar shows 1–7 shortcut badges and later clicks act as cmd+click (status bar buttons stop working). `press_key cmd` sometimes clears it; if the badges stay, restart the dev app. Verify state by screenshots, not AX `query`, which returned stale results while Home was visible.
