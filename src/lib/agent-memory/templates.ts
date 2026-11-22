// Fork（almanac ALMNC-54.3）：第一次使用時的 soul.md、rules.md 範本。
// soul.md 開頭記錄本名、角色、負責領域（只有專家）、代表色、語氣。範本不會自動存進資料庫：
// Scott 在設定頁按儲存後才成為正式內容；在那之前 agent 讀到的是範本（會跟著改名更新）。
import type { AgentRole } from '@/lib/agents/settings'

const ROLE_NAMES: Record<AgentRole, string> = {
  commander: '指揮官',
  expert: '專家',
  secretary: '秘書',
  researcher: '研究員',
}

/** 每個角色的預設代表色。 */
export const ROLE_COLORS: Record<AgentRole, string> = {
  commander: '#4F6BED',
  expert: '#2F9E77',
  secretary: '#D9822B',
  researcher: '#8E5CD9',
}

const ROLE_TONES: Record<AgentRole, string> = {
  commander: '沉穩、條理分明，先講結論再講理由。',
  expert: '精確、有根據，只引用筆記庫裡的內容，不確定就說不確定。',
  secretary: '簡短、確實，每次修改都回一行確認。',
  researcher: '好奇、謹慎，附上來源，分清楚已知和未知。',
}

export interface SoulTemplateAgent {
  name: string
  role: AgentRole
  domain?: string
}

export function roleTitle(agent: Pick<SoulTemplateAgent, 'role' | 'domain'>): string {
  if (agent.role === 'expert' && agent.domain?.trim()) return `${agent.domain.trim()}專家`
  return ROLE_NAMES[agent.role]
}

export function defaultSoul(agent: SoulTemplateAgent): string {
  const lines = [
    '# soul.md',
    '',
    `- 本名：${agent.name}`,
    `- 角色：${roleTitle(agent)}`,
    ...(agent.role === 'expert' ? [`- 負責領域：${agent.domain?.trim() || '待指定'}`] : []),
    `- 代表色：${ROLE_COLORS[agent.role]}`,
    `- 語氣：${ROLE_TONES[agent.role]}`,
  ]
  return `${lines.join('\n')}\n`
}

/** 規格「防止違規」第 1 點：共用工作記憶的規則寫進每個 agent 的 rules.md。 */
export function defaultRules(agent: Pick<SoulTemplateAgent, 'role'>): string {
  return [
    '# rules.md',
    '',
    '## 共用工作記憶',
    '- 只記「誰在什麼時候做了什麼、現在在忙什麼」，不記事情本身；只放標題和連結。',
    '- 不記領域知識、筆記內容摘要、任務與行程的時間或狀態、專案進度與決策、資料源原文、敏感資料。',
    '- 推測不寫進目前脈絡。',
    '- 活動紀錄不能改也不能刪；記錯就新增一筆更正。',
    agent.role === 'commander'
      ? '- 你負責維護目前脈絡：專案最多 10 個、本週重點最多 5 項。'
      : '- 不修改目前脈絡；發現有誤，寫一筆活動紀錄回報。',
    '- 回答 Scott 只引用筆記，不引用共用工作記憶；記憶和筆記不一致時以筆記為準。',
    '',
    '## 工作筆記',
    '- 只記怎麼做事（例如「Scott 喜歡附來源」），不記領域內容；領域內容寫成知識筆記草稿走提案。',
    '',
  ].join('\n')
}
