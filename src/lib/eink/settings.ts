// Fork（almanac ALMNC-45）：電子紙設定。純函式，存在 store.json（einkSettings；token 另存 einkToken）。
// 術語見 almanac GLOSSARY.md「電子紙同步」：電子紙、休眠畫面、今日簡報、釘選資料、每日回顧卡、每日精選文章。
// 這裡只存設定值；區網服務、今日簡報組裝與休眠畫面是後續票（ALMNC-47 起）的事。

/** 今日簡報的章節，順序就是簡報裡的順序（計畫 v2「今日簡報」一節）。 */
export const BRIEFING_SECTIONS = ['schedule', 'pinned', 'articles', 'review', 'report', 'workbench'] as const
export type BriefingSection = typeof BRIEFING_SECTIONS[number]

export interface EinkSettings {
  enabled: boolean
  /** 電子紙在區網的位址（File Transfer 模式時用），例如 192.168.1.20 或 http://x4.local */
  readerAddress: string
  /** 區網服務（給電子紙下載休眠畫面與今日簡報）；預設關閉。 */
  lanServer: boolean
  /** 今日簡報要放哪些章節；依 BRIEFING_SECTIONS 的順序存。 */
  sections: BriefingSection[]
  /** 天氣地點：使用者輸入的城市名稱（之後由 Open-Meteo 地理編碼換成座標）。 */
  weatherCity: string
}

export const EINK_SETTINGS_KEY = 'einkSettings'
/** token 獨立一個鍵，並列在設定同步的永遠排除清單：只留在這台 Mac。 */
export const EINK_TOKEN_KEY = 'einkToken'

export const DEFAULT_EINK_SETTINGS: EinkSettings = {
  enabled: false,
  readerAddress: '',
  lanServer: false,
  sections: [...BRIEFING_SECTIONS],
  weatherCity: '',
}

const MAX_TEXT = 200

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''
}

function isSection(value: unknown): value is BriefingSection {
  return typeof value === 'string' && (BRIEFING_SECTIONS as readonly string[]).includes(value)
}

/** 依固定章節順序排好、去重、丟掉不認得的值。 */
export function orderSections(values: readonly unknown[]): BriefingSection[] {
  const picked = new Set(values.filter(isSection))
  return BRIEFING_SECTIONS.filter(section => picked.has(section))
}

/** 讀回設定：壞資料與缺的欄位用預設值補上。 */
export function normalizeEinkSettings(saved: unknown): EinkSettings {
  const value = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_EINK_SETTINGS.enabled,
    readerAddress: text(value.readerAddress),
    lanServer: typeof value.lanServer === 'boolean' ? value.lanServer : DEFAULT_EINK_SETTINGS.lanServer,
    sections: Array.isArray(value.sections) ? orderSections(value.sections) : [...DEFAULT_EINK_SETTINGS.sections],
    weatherCity: text(value.weatherCity),
  }
}

/** 勾選／取消一個章節，結果仍照固定順序。 */
export function toggleSection(sections: readonly BriefingSection[], section: BriefingSection, on: boolean): BriefingSection[] {
  const rest = sections.filter(item => item !== section)
  return orderSections(on ? [...rest, section] : rest)
}

/**
 * 閱讀器位址：去掉前後空白與結尾斜線；沒寫通訊協定時補 http://（區網明文，計畫 v2 第 1 張驗證）。
 * 空字串回傳空字串；不是合法網址回傳 null（設定頁顯示錯誤、不存）。
 */
export function normalizeReaderAddress(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname || url.username || url.password || url.search || url.hash) return null
    return withScheme
  } catch {
    return null
  }
}

/** 天氣地點：城市名稱，去掉多餘空白。 */
export function normalizeWeatherCity(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

export const TOKEN_BYTES = 24

/** 產生新的 token：密碼學亂數、URL 安全（hex）。不記 log。 */
export function generateEinkToken(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(TOKEN_BYTES))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function isValidEinkToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32,128}$/.test(value)
}

/** 設定頁顯示用：只露出最後 4 碼。 */
export function maskEinkToken(token: string): string {
  if (!token) return ''
  return `${'•'.repeat(8)}${token.slice(-4)}`
}
