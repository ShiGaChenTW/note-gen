---
title: "編輯器已開啟的筆記不會跟著外部檔案變更更新，之後存檔會蓋掉外部內容"
author: Scottchen
date: 2026-11-01
branch: sync/upstream-2026-11-01
id: l-a0094380
scope: repo
status: active
src: agent
---

## Decided
這不是 v0.39.2 同步造成的，同步也沒有修改它。`use-workspace-file-watcher.ts` 收到一般修改事件只呼叫 `markFileDirty`，不會把新內容送進已開啟的編輯器。上游 07360280 的游標修正走的是同步事件 `event.content`，不是這條路徑。
## Tried and ruled out
用外部程式改磁碟上的檔案，無法測到 07360280 的游標保留，因為編輯器根本沒有更新。要測得透過遠端同步事件。
## Watch out
2026-11-01 實測：筆記開著時從外部插入一段，等 4 秒後在編輯器打字並按 Cmd+S，外部插入的段落就從檔案消失了，也沒有提示。讓 Obsidian 或 Agent 同時改已開啟的筆記時要留意，要修的話從 watcher 和編輯器之間補重新載入或衝突提示。
