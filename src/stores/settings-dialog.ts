import { create } from 'zustand'

export type BuiltinSettingSection =
  | 'about'
  | 'general'
  | 'partners'
  | 'record'
  | 'daily'
  | 'editor'
  | 'canvas'
  | 'sync'
  | 'backup'
  | 'imageHosting'
  | 'ai'
  | 'webSearch'
  | 'rag'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'prompt'
  | 'memories'
  | 'template'
  | 'file'
  | 'shortcuts'
  | 'imageMethod'
  | 'audio'
  | 'eink'

export type PluginSettingSection = `plugin:${string}`
export type SettingSection = BuiltinSettingSection | PluginSettingSection

export function isPluginSettingSection(section: string): section is PluginSettingSection {
  return section.startsWith('plugin:') && section.length > 'plugin:'.length
}

export const settingSections: SettingSection[] = [
  'about',
  'general',
  'record',
  'daily',
  'editor',
  'canvas',
  'shortcuts',
  'imageMethod',
  'audio',
  'partners',
  'ai',
  'webSearch',
  'rag',
  'memories',
  'prompt',
  'mcp',
  'skills',
  'plugins',
  'template',
  'sync',
  'backup',
  'imageHosting',
  'file',
  'eink',
]

// Fork（almanac ALMNC-45）：只在新介面（V3）出現的設定分頁；classic 下不列在選單、也不會停在這頁。
// ALMNC-83.5：夥伴（夥伴名單、Agent 設定區、調研與回顧、自動整理、自動接受）從常規設定搬出來的獨立分頁。
export const v3OnlySettingSections: readonly BuiltinSettingSection[] = ['eink', 'partners']

export function isV3OnlySettingSection(section: string): boolean {
  return (v3OnlySettingSections as readonly string[]).includes(section)
}

/**
 * Fork（almanac ALMNC-83）：新介面（V3）下不列出的分頁；classic 照舊顯示。
 * ALMNC-83.2：記憶管理（對話 agent 的記憶）在新介面併進夥伴分頁的 Agent 設定區。
 */
export const classicOnlySettingSections: readonly BuiltinSettingSection[] = ['memories']

/** Fork（almanac ALMNC-83）：功能關閉、兩種介面都不列出的分頁（資料保留）。 */
export const disabledSettingSections: readonly BuiltinSettingSection[] = []

/** 這個分頁在目前介面（v3 = 新介面）是否顯示。外掛分頁另外判斷，這裡一律回 true。 */
export function isSettingSectionVisible(section: string, v3: boolean): boolean {
  if ((disabledSettingSections as readonly string[]).includes(section)) return false
  if (v3) return !(classicOnlySettingSections as readonly string[]).includes(section)
  return !isV3OnlySettingSection(section)
}

/**
 * 目前介面看不到 section 時要改停的分頁；section 本來就看得到時原樣回傳。
 * 記憶管理在新介面併進夥伴分頁（ALMNC-83.2），其他一律回一般。
 */
export function fallbackSettingSection(section: BuiltinSettingSection, v3: boolean): BuiltinSettingSection {
  if (isSettingSectionVisible(section, v3)) return section
  if (section === 'memories' && isSettingSectionVisible('partners', v3)) return 'partners'
  return 'general'
}

/** 對話 agent 的記憶在哪個分頁：新介面是夥伴分頁的 Agent 設定區，classic 是記憶管理（ALMNC-83.2）。 */
export function memorySettingSection(v3: boolean): BuiltinSettingSection {
  return fallbackSettingSection('memories', v3)
}

interface SettingsDialogState {
  open: boolean
  activeSection: SettingSection
  pluginDiscoveryRequest: { query: string; installPluginId?: string } | null
  openPluginDiscovery: (query: string) => void
  openPluginInstall: (pluginId: string) => void
  clearPluginDiscoveryRequest: () => void
  openSettings: (section?: SettingSection) => void
  closeSettings: () => void
  setActiveSection: (section: SettingSection) => void
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  activeSection: 'about',
  pluginDiscoveryRequest: null,
  openPluginDiscovery: (query) => set({
    open: true,
    activeSection: 'plugins',
    pluginDiscoveryRequest: { query },
  }),
  openPluginInstall: (pluginId) => set({
    open: true,
    activeSection: 'plugins',
    pluginDiscoveryRequest: { query: pluginId, installPluginId: pluginId },
  }),
  clearPluginDiscoveryRequest: () => set({ pluginDiscoveryRequest: null }),
  openSettings: (section) => set((state) => ({
    open: true,
    activeSection: section ?? state.activeSection,
  })),
  closeSettings: () => set({ open: false }),
  setActiveSection: (activeSection) => set({ activeSection }),
}))
