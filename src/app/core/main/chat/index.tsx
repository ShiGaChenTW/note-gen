'use client'
import { ChatHeader } from './chat-header'
import { ChatInput } from "./chat-input";
import ChatContent from "./chat-content";
import { ClipboardListener } from "./clipboard-listener";

import { useUiV3 } from '@/lib/fork-ui'
import { ChatV3Context } from './chat-v3'
import { PendingAgentReview } from './pending-agent-review'
import { ThreadStatusBar } from '../threads/thread-status' // Fork（almanac ALMNC-54.4）
import { RouteChooser } from './route-chooser' // Fork（almanac ALMNC-54.11）

export default function Chat() {
  const v3 = useUiV3()

  return <ChatV3Context.Provider value={v3}><div id="record-chat" className="flex-col flex-1 flex relative overflow-x-hidden items-center h-full overflow-hidden v3:bg-bg">
    <ChatHeader />
    {v3 && <ThreadStatusBar />}
    <ChatContent />
    <ClipboardListener />
    {v3 && <PendingAgentReview />}
    {v3 && <RouteChooser />}
    <ChatInput />
  </div></ChatV3Context.Provider>
}
