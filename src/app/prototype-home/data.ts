// PROTOTYPE: 假資料，只給 /prototype-home 用。

export type CardKey = 'schedule' | 'report' | 'signals' | 'capture' | 'recent' | 'tasks' | 'footprint' | 'health'

export const CARDS: { key: CardKey; name: string; defaultOn: boolean }[] = [
  { key: 'schedule', name: '日程', defaultOn: true },
  { key: 'report', name: '知識報告', defaultOn: true },
  { key: 'signals', name: '可以交給 Agent', defaultOn: true },
  { key: 'capture', name: '快速記錄', defaultOn: true },
  { key: 'recent', name: '最近筆記', defaultOn: true },
  { key: 'tasks', name: 'Agent 任務', defaultOn: true },
  { key: 'footprint', name: '本週足跡', defaultOn: false },
  { key: 'health', name: '知識庫健康', defaultOn: false },
]

export const today = { date: '2026-10-26', weekday: '週一', week: 'W44' }

export const events = [
  { time: '10:00', end: '11:00', title: '產品週會', calendar: '工作' },
  { time: '14:00', end: '14:40', title: '牙醫回診', calendar: '個人' },
  { time: '19:30', end: '21:00', title: 'Rust 讀書會', calendar: '學習' },
]

export const todos = [
  { id: 't1', text: '回覆 Kaneo 估價', due: '10-23', overdueDays: 3, note: '2026-10-23', time: null as string | null },
  { id: 't2', text: '整理 Rust 所有權筆記', due: '今天', overdueDays: 0, note: '2026-10-26', time: '15:00' },
  { id: 't3', text: '繳電費', due: '今天', overdueDays: 0, note: '2026-10-25', time: null },
  { id: 't4', text: '寄出讀書會講義', due: '今天', overdueDays: 0, note: '讀書會/第 6 次', time: '18:00' },
]

export type Level = '接觸' | '整理' | '內化' | '融會'
export const LEVELS: Level[] = ['接觸', '整理', '內化', '融會']

export const report = {
  title: '2026-W43 知識報告',
  path: '報告/2026-W43 知識報告.md',
  generatedAt: '10-25 21:04',
  tokens: '182k',
  topics: [
    { name: 'Rust', level: '內化' as Level, prev: '整理' as Level, score: 63, notes: 41, gap: '還差：跨主題連結（和 Tauri 之間只有 1 條連結）', evidence: '「借用檢查其實是在編譯期證明沒有兩個可變參考……」— [[Rust/所有權]]' },
    { name: '個人知識管理', level: '融會' as Level, prev: '融會' as Level, score: 88, notes: 67, gap: '已是最高級；建議寫一篇年度回顧', evidence: '「MOC 不是目錄，是我對這個領域的地圖」— [[PKM/MOC 的用法]]' },
    { name: 'Tauri', level: '接觸' as Level, prev: '接觸' as Level, score: 22, notes: 12, gap: '還差：12 篇都是摘抄，沒有自己的整理', evidence: '12 篇中 11 篇為網頁剪藏，無改寫 — [[Tauri/官方文件剪藏]]' },
    { name: '投資理財', level: '整理' as Level, prev: '內化' as Level, score: 41, notes: 23, gap: '下降原因：30 天沒回顧；記憶顯示你 9 月決定調整配置但筆記沒有更新', evidence: '記憶（decision，09-14）：「改成 60/40 配置」' },
    { name: '日語', level: '接觸' as Level, prev: '接觸' as Level, score: 15, notes: 6, gap: '還差：有結構的整理（目前只有單字列表）', evidence: '[[日語/N3 單字]]' },
  ],
  suggestions: [
    { id: 's1', topic: 'Rust', text: '「生命週期」相關的 5 篇講同一件事，可以合併成一篇', done: false },
    { id: 's2', topic: 'Tauri', text: '這個主題只有摘抄，寫一篇用自己的話解釋 IPC 的筆記', done: false },
    { id: 's3', topic: '投資理財', text: '把 9 月的配置決定補進「資產配置」筆記', done: false },
    { id: 's4', topic: 'Rust', text: '補上 Rust 和 Tauri 之間的連結（建議 4 處）', done: true },
  ],
  stats: { unlinked: 8, orphans: 14, inbox: 5, total: 3041 },
}

export const signals = [
  { id: 'g1', text: 'Inbox 有 5 則待整理，最久一則放了 4 天', prompt: '整理 Inbox 的 5 則快速記錄，歸到對應主題並補連結' },
  { id: 'g2', text: '「回覆 Kaneo 估價」已逾期 3 天', prompt: '幫我起草回覆 Kaneo 估價的內容' },
  { id: 'g3', text: '8 篇筆記缺少連結', prompt: '為缺少連結的 8 篇筆記建議雙鏈' },
  { id: 'g4', text: '知識報告還有 3 條優化建議未處理', prompt: '處理 W43 知識報告的優化建議' },
  { id: 'g5', text: '昨天沒寫每日筆記', prompt: '根據昨天的修改紀錄幫我補寫每日筆記草稿' },
]

export type TaskState = '等你回應' | '進行中' | '沒做完' | '已完成'
export const agentTasks = [
  { id: 'a1', title: '整理 Inbox（5 則）', state: '等你回應' as TaskState, detail: '草稿：6 項變更待審', tokens: '24k' },
  { id: 'a2', title: '產出 W44 知識報告', state: '進行中' as TaskState, detail: '分析 37 篇變動筆記 · 62%', tokens: '91k' },
  { id: 'a3', title: '合併 Rust 生命週期筆記', state: '沒做完' as TaskState, detail: 'app 關閉時中斷，草稿已保留', tokens: '12k' },
  { id: 'a4', title: '為 Tauri 主題補連結', state: '已完成' as TaskState, detail: '已收下 4 項', tokens: '8k' },
]

export const conversations = [
  { id: 'c1', title: 'Rust 借用檢查為什麼擋我', when: '今天 09:12', summarized: false },
  { id: 'c2', title: 'Tauri 視窗權限設定', when: '昨天', summarized: true },
  { id: 'c3', title: '週末複盤：十月第四週', when: '昨天', summarized: false },
]

export const recentNotes = [
  { title: 'Rust/所有權', folder: 'Rust', when: '12 分鐘前', excerpt: '借用檢查其實是在編譯期證明沒有兩個可變參考同時存在。今天讀書會前要把 move 語意的例子補完……' },
  { title: '2026-10-26', folder: '每日筆記', when: '35 分鐘前', excerpt: '' },
  { title: 'Tauri/IPC 筆記', folder: 'Tauri', when: '昨天', excerpt: '' },
  { title: '資產配置', folder: '投資理財', when: '3 天前', excerpt: '' },
  { title: 'PKM/MOC 的用法', folder: 'PKM', when: '4 天前', excerpt: '' },
]

export const footprint = [
  { day: '一', write: 3, edit: 9, reread: 4 },
  { day: '二', write: 1, edit: 5, reread: 2 },
  { day: '三', write: 4, edit: 11, reread: 6 },
  { day: '四', write: 0, edit: 2, reread: 1 },
  { day: '五', write: 2, edit: 7, reread: 3 },
  { day: '六', write: 5, edit: 3, reread: 8 },
  { day: '日', write: 1, edit: 4, reread: 2 },
]

export const draftChanges = [
  { id: 'd1', kind: '新增' as const, path: 'Rust/借用與生命週期.md', summary: '由 Inbox 3 則合併的新筆記（+42 行）', conflict: false },
  { id: 'd2', kind: '修改' as const, path: 'Rust/所有權.md', summary: '在「延伸」一節加入 [[Rust/借用與生命週期]]（+2 行）', conflict: true },
  { id: 'd3', kind: '修改' as const, path: 'Tauri/IPC 筆記.md', summary: '補上 2 個雙鏈（+2 行）', conflict: false },
  { id: 'd4', kind: '修改' as const, path: '2026-10-26.md', summary: '新增待辦「讀完 Nomicon 第 3 章 📅 2026-10-30」（+1 行）', conflict: false },
  { id: 'd5', kind: '搬移' as const, path: 'Inbox/電影清單.md → 生活/電影清單.md', summary: '逐條確認', conflict: false },
  { id: 'd6', kind: '刪除' as const, path: 'Inbox/空白.md', summary: '空白筆記，逐條確認', conflict: false },
]

export const summaryDraft = {
  path: '對話摘要/2026/10/2026-10-26 Rust 借用檢查為什麼擋我.md',
  frontmatter: 'type: 對話摘要\nconversation: c1\ndate: 2026-10-26\ntopics: [Rust]',
  sections: [
    { h: '我的問題', body: '為什麼同時持有一個 &mut 和一個 & 會編譯失敗？' },
    { h: '我的觀點與理解', body: '我原本以為是執行期鎖；現在理解是編譯期證明「不會有兩個可變別名」。' },
    { h: 'AI 的解答重點', body: '- 借用規則：同一時間只能有一個可變參考，或多個不可變參考\n- NLL 讓借用在最後一次使用後就結束' },
    { h: '結論與決定', body: '讀書會前把 move 語意的例子補進筆記。' },
    { h: '還沒解決的問題', body: '`Rc<RefCell<T>>` 什麼時候該用？' },
    { h: '相關筆記', body: '[[Rust/所有權]] · [[Rust/借用與生命週期]]' },
  ],
}
