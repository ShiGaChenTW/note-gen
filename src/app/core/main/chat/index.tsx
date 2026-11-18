'use client'
import { ChatHeader } from './chat-header'
import { ChatInput } from "./chat-input";
import ChatContent from "./chat-content";
import { ClipboardListener } from "./clipboard-listener";

import { useUiV3 } from '@/lib/fork-ui'
import { ChatV3Context } from './chat-v3'
import { PendingAgentReview } from './pending-agent-review'

export default function Chat() {
  const v3 = useUiV3()

  return <ChatV3Context.Provider value={v3}><div id="record-chat" className="flex-col flex-1 flex relative overflow-x-hidden items-center h-full overflow-hidden v3:bg-bg">
    <ChatHeader />
    <ChatContent />
    <ClipboardListener />
    {v3 && <PendingAgentReview />}
    <ChatInput />
  </div></ChatV3Context.Provider>
}
