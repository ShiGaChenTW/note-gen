---
title: UI prototypes run in a plain browser via next dev when the route lives outside /core
author: Scottchen
date: 2026-10-25
branch: prototype/phase3-home
cost: { minutes: 6, tokens: 262300 }
id: l-e8d95d77
scope: repo
status: active
src: agent
touches:
  - package.json
  - src/app/prototype-home/data.ts
  - src/app/prototype-home/overlays.tsx
  - src/app/prototype-home/page.tsx
  - src/app/prototype-home/variants.tsx
  - src/components/prototype-switcher.tsx
  - src/app/core/layout.tsx
  - src/app/layout.tsx
  - personal/notegen-obsidian-baseline.css
  - src/lib/check.ts
---

## Decided
- Throwaway UI routes go under `src/app/<name>/` (not `src/app/core/`), because `src/app/core/layout.tsx` runs the Tauri startup chain (DB init, memory maintenance, sync). The root layout (`src/app/layout.tsx`) guards Tauri calls with `isTauri()`, so such a route renders in Chrome with `next dev --turbopack -p 3456` alone, without `tauri dev` or the worker esbuild steps.
- Theme fidelity: scope the dark amber vars from `personal/notegen-obsidian-baseline.css` on a wrapper class; `globals.css` defaults are not the fork's look.

## Watch out
- Next's dev overlay shows "1 Issue: Cannot read properties of undefined (reading 'platform')" from `src/lib/check.ts` `isMobileDevice` in a plain browser; it is the Tauri OS plugin missing, harmless for prototypes.
