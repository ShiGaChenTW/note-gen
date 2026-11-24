'use client'

// Fork（almanac ALMNC-83.2）：Agent 設定區裡的「對話記憶」——對話 agent 的記憶（lib/memory，memories 表）。
// 新介面不再有獨立的記憶管理分頁，改在這裡看與編輯；資料、讀取點（lib/context/loader.ts、agent 的記憶工具）都不變，
// 和夥伴的記憶（lib/agent-memory）並列、不互相搬移。classic 仍用設定 > 記憶管理。
import { useTranslations } from 'next-intl'
import { MemoryList } from '@/components/memories/memory-list'
import { SettingSection } from '../components/setting-base'

export function ChatMemorySettings() {
  const t = useTranslations('agents.chatMemory')
  return (
    <SettingSection title={t('title')} desc={t('desc')}>
      <div data-testid="agent-chat-memory">
        <MemoryList />
      </div>
    </SettingSection>
  )
}
