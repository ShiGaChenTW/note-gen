---
title: Analyzing codex-echoink (EchoInk Obsidian plugin) with rea
author: Scottchen
date: 2026-10-24
branch: dev
cost: { minutes: 2, tokens: 129019 }
touches:
  - ".vscode/mcp.json"
  - designs/frontmatter-card/prototype.html
  - designs/graft/.cache/session/e771aad2-6684-421b-86d6-352cb65be838.json
  - designs/graft/.cache/telemetry-repo-id.json
  - designs/login.pen
  - designs/login.png
  - designs/notegen-editor-v1.fig
---

## Decided
- For a public Obsidian plugin repo, download the release (`gh release download <tag>`) and clone the source into separate empty scratchpad dirs, then read `src/` for architecture and use rea on the release `main.js` only for shipped-artifact facts.
- codex-echoink 2.8.4 summary: Obsidian plugin on `@earendil-works/pi-*` 0.82.1 agent core; memory = Markdown files with JSON frontmatter plus manifest/tombstones (`src/harness/memory/`); `dream-engine.ts` runs a transactional background profile/memory round; `/maintain` builds Wiki pages and preserves hand-written text; per-agent capability policy; PRO gating via signed lease (`src/membership/`). MIT base plus commercial PRO license.

## Tried and ruled out
- `analyze_javascript_application` on the 12MB bundle (directory input, 4GB heap) gave only partial coverage: semantic graph exceeded the result budget, 0 modules, no call/data-flow relations. Not usable for call graphs on this bundle.
- `trail map`-style `ls` with `--icons` alias: `ls` is aliased in this shell, use `/bin/ls`.

## Watch out
- Hosts, Node builtins and bundled libs were obtained by grepping `main.js`, not by rea; do not present them as rea results.
- Source-vs-release equality was not verified (`compare_source_to_bundle` not run).
