---
title: "Issue #57: 對話內取用提示詞——模型建議一次性套用、新對話系統提示詞的作法"
author: Scottchen
date: 2026-10-26
branch: feat/57-prompt-in-chat
cost: { minutes: 31, tokens: 412029 }
touches:
  - messages/de.json
  - messages/en.json
  - messages/ja.json
  - messages/pt-BR.json
  - messages/zh-TW.json
  - messages/zh.json
  - src/app/core/main/chat/agent-session-context.ts
  - src/app/core/main/chat/chat-composer-menu.tsx
  - src/app/core/main/chat/chat-content.tsx
  - src/app/core/main/chat/chat-input.tsx
---

## Decided
- 提示詞 frontmatter 的 `model`／`temperature` 建議，比對的是模型設定條目的「模型字串」（`ModelConfig.model`，如 `claude-sonnet-5-5`），不是 `ModelConfig.id`／`AiConfig.key`——那兩個都是 `v4()` 隨機 uuid，使用者不可能在 frontmatter 寫出來。新函式 `resolvePromptModelSuggestion`（src/lib/prompt-library/chat-model-suggestion.ts）靠 `collectGroupedChatModels` 取得的 `item.model.model` 做大小寫不敏感比對。
- 「點一下套用到這一則訊息，下一則自動恢復」沒有疊代既有的 `reasoningOverride`（那個存在 chat store、會跨訊息持續存在，只在切換對話時才清空，見 src/stores/chat.ts 的 `reasoningOverride: null` 散落各處）。新增的 `modelOverride` 改成 ChatInput 的 local state（`promptSuggestion.armed`），透過 props 一路傳進 `AgentRequestSnapshot.modelOverride`，送出後在 `handleSent()` 裡清掉——不进全域 store，因為語意本來就是一次性、非跨訊息持久。
- 「用這個提示詞開新對話」的 system prompt 沒有動 `conversations` 資料表結構（会牵动 conversation-sync 的欄位同步），改成插入一筆 `role:'system', type:'conversation_prompt'` 的 chat 記錄，完全複用既有的 `model_change` marker 模式：`buildMessagesWithHistory`／`buildChatHistoryForAI`（src/lib/ai/history-messages.ts）本来就只认 `type === 'chat' || type === 'note'`，其它 type 自动不会进 AI 看到的訊息；sync 允许清单在 src/lib/sync/conversation-sync.ts 的 `chatTypes` Set，新 type 要记得同时加进去，否则同步时会被验证函式吞掉。
- Agent 的 system prompt 组装在 src/lib/agent/runtime.ts 的 `customSystemPrompt = await getSystemPromptContent()`，这行只出现一次赋值但在 run() 里被读两次（初始 assemble 与 steering 追加后的 re-assemble）；改成 `input.systemPromptOverride?.trim() || await getSystemPromptContent()` 一行就能让两处都生效，不用分别改。`systemPromptOverride` 是「取代」全域自订 system prompt，不是附加。

## Watch out
- `src/stores/prompt.ts` 的 `promptList`／`currentPrompt`（chat persona，GLOSSARY 叫「對話角色」）跟个人提示词库完全是两套机制，不要混着改——新對話的 system prompt 绝不写进 `promptList`。
- 新增 ChatType 字面值时，除了 `src/db/chats.ts` 的 `ChatType` union，一定要同步 `src/lib/sync/conversation-sync.ts` 里的 `chatTypes` Set，否则该类型的消息在同步校验时会被当成无效数据丢弃。
