---
title: "Radix Sheet in note-gen: dialogs opened from it render behind it, and it closes when the file tree steals focus"
author: Scottchen
date: 2026-10-25
branch: feat/35-knowledge-report
id: l-717f9952
scope: repo
status: active
src: agent
touches:
  - messages/de.json
  - messages/en.json
  - messages/ja.json
  - messages/pt-BR.json
  - messages/zh-TW.json
  - messages/zh.json
  - personal/FORK-CHANGES.md
  - src/app/core/main/agent-tasks/agent-tasks-sheet.tsx
  - src/app/core/main/home/cards/needs-list.tsx
---

## Decided
- `home/cards/report-drawer.tsx`: before opening the handoff `Dialog` (`HandoffDialog`, mounted in `home-screen.tsx`) from inside the report `Sheet`, call `closeDrawer()` first. Both portal to body at `z-50`, and in the running app the dialog ended up hidden behind the sheet (AX tree had its "開始" button, the screenshot did not).
- Same file: `SheetContent` gets `onFocusOutside={event => event.preventDefault()}`. Writing the first note into a new folder (`報告/主題清單.md`) reloads the file tree, which takes focus, and Radix treats that as an outside interaction and closes the sheet mid-flow. Overlay click and Esc still close it.
- Sheet width: the shared `components/ui/sheet.tsx` sets `data-[side=right]:sm:max-w-sm`, which beats a plain `sm:max-w-[560px]`; use `data-[side=right]:w-[...] data-[side=right]:sm:max-w-[...]` (also fixed in `agent-tasks-sheet.tsx`).

## Watch out
- `NumberField` in `home/cards/signals-card.tsx` clamps on every keystroke, so a field with a large minimum (e.g. 1000) can never be typed into: clearing and typing "1" jumps to 1000, then digits append. The report token limit uses its own commit-on-blur `TokenLimitField` in `report-card.tsx`.
- cua-driver: `set_value` / element-token `type_text` on these React inputs does not reach React; pixel `click` at the field, `press_key cmd+a`, `delete`, then `type_text` with `x,y` does.
