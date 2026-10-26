---
title: Fork 預設視覺放在 fork-theme.css，不改 globals.css
author: Scottchen
date: 2026-10-26
branch: feat/obsidian-default-theme
cost: { minutes: 9, tokens: 72594 }
id: l-04b906a4
scope: repo
status: active
src: agent
touches:
  - personal/notegen-obsidian-baseline.css
  - src/app/fork-theme.css
  - src/app/layout.tsx
  - src/lib/font-settings.ts
---

## Decided
- 色票寫在 `src/app/fork-theme.css`，在 `layout.tsx` 裡排在 `globals.css` 之後匯入，且不放進 `@layer`，because 沒進 layer 的規則一定蓋過 globals 的 `@layer base`，上游的 `globals.css` 就不用動，同步上游時不會衝突。設定裡的自訂主題仍然優先，because `theme-utils.ts` 用 `:root.dark` 寫在 head 最後面的 style 裡。
- 淺色主色用深琥珀 `31 92% 35%`，不用深色版的 `43 96% 56%`，because 亮琥珀放在白底上當文字只有 1.7:1；`--primary` 同時用在按鈕底色和文字上，深琥珀兩種用法都有約 4.8:1。
## Watch out
- `--scrollbar-thumb`／`--scrollbar-thumb-hover` 在 globals 裡是直接當顏色用（`background-color: var(--scrollbar-thumb)`），所以要寫 `hsl(...)`。寫裸 HSL 數值不會報錯，只是靜靜失效。
- 自訂 CSS 的註解區塊裡如果還有 `/* … */`，註解會提早結束，後面一條規則的選擇器會變成無效，整條被丟掉，而且不會有任何錯誤提示。
