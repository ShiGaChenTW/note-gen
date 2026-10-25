---
status: accepted
---

# 背景 Agent 任務由 fork 自建的任務中心執行，不改上游對話元件

Agent 任務要能脫離對話視窗在背景執行、同時跑多個、等待使用者審核。上游的執行核心 `AgentRuntime` 與權限引擎不依賴 React，但啟動、確認與狀態寫入綁在 `chat-send.tsx` 與全域單份的 `useChatStore.agentState`。我們決定由 fork 自建任務中心：重用 `AgentRuntime`，透過 `AgentStateAdapter` 提供每個任務各自的狀態，任務記錄在獨立的任務表；對話中的「丟到背景」只是把指令交給任務中心。上游對話元件維持原樣，以降低每次同步上游的衝突。

## Considered Options

- 改造上游對話元件，讓每個對話各有一份 agent 狀態：對話與任務共用一套，但改動集中在上游最常變動的檔案，每次同步都會衝突。

## Consequences

- 背景任務的寫入先存成草稿，任務結束後由使用者彙整審核；刪除與搬移逐條確認。這是任務中心自己的流程，與對話中「每次改檔都停下來確認」不同。
- 執行進度不跨 app 重啟保存；重開後「繼續」是帶著已存草稿與紀錄重新啟動任務。
- 上游若改動 `AgentRuntime` 或 `AgentStateAdapter` 介面，任務中心需跟著調整。
