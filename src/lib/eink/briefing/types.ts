// Fork（almanac ALMNC-47）：今日簡報的資料模型，跟輸出格式無關。
// 今日簡報（EPUB，ALMNC-48）與休眠畫面（BMP，ALMNC-49）都從這份資料產生，兩邊才不會不一致；
// 以後換輸出格式或閱讀器，只要換掉讀這份資料的那一層。術語見 almanac GLOSSARY.md「電子紙同步」。

/** 章節種類；順序就是簡報裡的順序（卡片 ALMNC-47）。 */
export const CHAPTER_KINDS = ['schedule', 'weather', 'pinned', 'articles', 'review', 'report', 'workbench'] as const
export type ChapterKind = typeof CHAPTER_KINDS[number]

/**
 * 章節狀態：
 *   ok           有內容
 *   empty        來源正常但今天沒東西（章節保留，顯示 note）
 *   unavailable  沒授權或抓不到（章節保留，顯示 note）
 * 整章拿掉的不在 chapters 裡，記在 omitted。
 */
export type ChapterStatus = 'ok' | 'empty' | 'unavailable'

/** 來源回傳：有資料，或「沒資料／沒授權／出錯」之一。adapter 一律回這個，不丟錯。 */
export type SourceResult<T> =
  | { status: 'ok', data: T }
  | { status: 'empty' }
  | { status: 'denied' }
  | { status: 'error', message?: string }

// ---------- 今天行程 ----------

export type ScheduleItemKind = 'calendar' | 'task' | 'anchor'

export interface ScheduleItem {
  /** 私人標記用的鍵（src/lib/eink/privacy.ts 的 privacyKey），也是穩定排序的最後一層 */
  key: string
  kind: ScheduleItemKind
  title: string
  /** 毫秒；整天的行程是當天 00:00 */
  start: number
  /** 毫秒；沒有結束時間時為 0 */
  end: number
  allDay: boolean
  /** 行事曆名稱或任務所在筆記；時段為空字串 */
  source: string
  /**
   * Fork（almanac ALMNC-48／49）：地點。休眠畫面與今日簡報有就顯示；
   * 目前行事曆來源（src/lib/calendar）還沒帶地點，所以都是 undefined，等來源補上就會出現。
   */
  location?: string
  /**
   * 私人行程：資料照樣完整保留。今日簡報完整顯示（計畫 v2），
   * 休眠畫面只顯示「私人行程」和時間（ALMNC-49 讀這個旗標）。
   */
  private: boolean
}

// ---------- 天氣 ----------

export type DayPart = 'morning' | 'noon' | 'evening' | 'night'

export interface WeatherPart {
  part: DayPart
  /** 攝氏，四捨五入到整數 */
  temperature: number
  /** 降雨機率 %，取時段內最高 */
  precipitationProbability: number
  /** WMO 天氣代碼，取時段內最嚴重（數字最大）的 */
  weatherCode: number
}

export interface WeatherData {
  /** 地理編碼回來的地名 */
  location: string
  parts: WeatherPart[]
  high: number
  low: number
  precipitationProbability: number
  weatherCode: number
}

// ---------- 釘選資料 ----------

export interface PinnedItem {
  path: string
  title: string
  /** full：今天章節裡放全文；title：只列標題、全文在附錄；missing：讀不到內容（檔案不見或不是文字檔） */
  mode: 'full' | 'title' | 'missing'
  content?: string
  /** mode = title 時對應的附錄 id */
  appendixId?: string
}

// ---------- 每日精選文章 ----------

export interface ArticleItem {
  url: string
  title: string
  author?: string
  content: string
  images: string[]
  addedAt: number
}

// ---------- 每日回顧卡 ----------

export interface ReviewCard {
  path: string
  title: string
  excerpt: string
}

// ---------- 知識報告 ----------

export interface ReportSummary {
  path: string
  period: string
  generated: string
  topics: Array<{ name: string, level: string, score: number, prevLevel: string | null }>
  /** 還沒處理的優化建議 */
  suggestions: string[]
  stats: { notes: number, unlinked: number, orphans: number, inbox: number }
}

// ---------- 工作台摘要 ----------

export interface WorkbenchData {
  /** 要決定：等 Scott 接受、討論或放棄的提案 */
  decide: Array<{ key: string, title: string, when: string, at: number }>
  /** 要完成：逾期或今天到期、還沒做的任務 */
  complete: Array<{ path: string, line: number, title: string, due: string, overdue: boolean }>
}

// ---------- 章節 ----------

interface ChapterBase<K extends ChapterKind> {
  kind: K
  title: string
  status: ChapterStatus
  note?: string
}

export interface ScheduleChapter extends ChapterBase<'schedule'> { items: ScheduleItem[] }
export interface WeatherChapter extends ChapterBase<'weather'> { weather: WeatherData | null }
export interface PinnedChapter extends ChapterBase<'pinned'> { items: PinnedItem[] }
export interface ArticlesChapter extends ChapterBase<'articles'> { items: ArticleItem[] }
export interface ReviewChapter extends ChapterBase<'review'> { items: ReviewCard[] }
export interface ReportChapter extends ChapterBase<'report'> { report: ReportSummary | null }
export interface WorkbenchChapter extends ChapterBase<'workbench'> {
  decide: WorkbenchData['decide']
  decideCount: number
  complete: WorkbenchData['complete']
  completeCount: number
}

export type BriefingChapter =
  | ScheduleChapter | WeatherChapter | PinnedChapter | ArticlesChapter | ReviewChapter | ReportChapter | WorkbenchChapter

export interface AppendixEntry {
  id: string
  kind: 'pin'
  path: string
  title: string
  content: string
}

export type OmitReason = 'disabled' | 'empty' | 'unavailable' | 'not-new'

/**
 * 真的送出後要更新的「已送」狀態清單。組裝時只算出來，不寫回；
 * 區網下載成功（ALMNC-50）或立即推送（ALMNC-52）後呼叫 commitSent(briefing) 才寫。
 */
export interface SentManifest {
  articleUrls: string[]
  pinPaths: string[]
  reviewPaths: string[]
  reportPeriod?: string
}

export interface Briefing {
  /** YYYY-MM-DD（本地日期） */
  date: string
  chapters: BriefingChapter[]
  appendix: AppendixEntry[]
  /** 整章拿掉的章節與原因（除錯、設定頁說明用） */
  omitted: Array<{ kind: ChapterKind, reason: OmitReason }>
  sent: SentManifest
}
