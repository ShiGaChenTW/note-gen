// NoteGen Today — entry.js（單檔 ESM；worker 的 setModuleLoader 只認 plugin:entry，不能 import 其他檔）
// Created: 2026-10-14 18:05 | Modified: 2026-10-14 21:50 | Source: Claude (Fable 5.1)
// 依 note-gen @ 9859c6e 的 plugin-runtime.worker.ts 契約：export activate(context) / deactivate()
// 畫面走宣告式 UI（ui.views.update → blocks）。

// ---------- 移植自 command-center_v2（逐字搬，去掉 obsidian 依賴；來源以註解標示） ----------
// taskLine.ts:13-31
const TASK_CHECKBOX_RE = /^(\s*[-*+]\s+\[)([ xX/\-?])(\](?:\s+.*)?)$/
const TASK_DUE_RE = /(?<![\p{L}\p{N}_-])(due::\s*)(\d{4}-\d{2}-\d{2})/u
const TASK_DUE_EMOJI_RE = /(📅️?\s*)(\d{4}-\d{2}-\d{2})/u
const stripCR = (line) => line.replace(/\r$/, '')

// taskScan.ts:26-52
function parseTaskLine(line) {
  const m = stripCR(line).match(TASK_CHECKBOX_RE)
  if (!m) return null
  const done = m[2].toLowerCase() === 'x'
  const body = m[3].replace(/^\]\s*/, '')
  const due = body.match(TASK_DUE_RE)?.[2] ?? body.match(TASK_DUE_EMOJI_RE)?.[2] ?? ''
  const rawPri = body.match(/priority::\s*(high|medium|mid|low)/i)?.[1]?.toLowerCase() ?? ''
  const priority = rawPri === 'high' ? 'high' : rawPri === 'low' ? 'low' : 'mid'
  const title = body
    .replace(/🔁.*$/u, '')
    .replace(new RegExp(TASK_DUE_EMOJI_RE.source, 'gu'), '')
    .replace(/[[（(]\s*\w+::[^\]）)]*[\]）)]/g, '')
    .replace(/\w+::\s*\S+/g, '')
    .replace(/(^|\s)#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])[\p{L}\p{N}_/-]+/gu, '$1')
    .replace(/[✅🔼⏫🔽🔺⏬🛫⏳📅🔁➕❌]️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { done, title, text: title, due, priority }
}
// taskScan.ts:59-64：overdue = 未完成且到期日 < 今天；today = 到期日 = 今天（含已完成）；其餘 other
function bucketFor(t, now) {
  const todayStr = ymd(now)
  if (!t.due) return 'other'
  if (t.due < todayStr) return t.done ? 'other' : 'overdue'
  if (t.due === todayStr) return 'today'
  return 'other'
}
// paths.ts:44 taskExcludePrefixes + :54 NOT_TASK_PREFIXES
const NOT_TASK_PREFIXES = ['00 System/07 dev/', 'temp/', 'copilot/', 'plans/', 'openspec/', '10 Inbox/', '00.Inbox/', 'inbox/', '00 System/05 templates/']
const isTaskSource = (path) => !NOT_TASK_PREFIXES.some(p => path.startsWith(p))

// cockpit/dailyNote.ts:33-166
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu
function cleanText(s) {
  return s.replace(EMOJI_RE, '')
    .replace(/[\[（(]\s*\w+::[^\]）)]*[\]）)]/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ').trim()
}
const BULLET_RE = /^\s*[-*+](?:\s+(.*))?$/
function parseBullet(raw, lineNo) {
  const t = raw.match(TASK_CHECKBOX_RE)
  if (t) return { text: cleanText(t[3].replace(/^\]\s*/, '')), lineNo, raw, isTask: true, done: t[2].toLowerCase() === 'x' }
  const b = raw.match(BULLET_RE)
  if (!b) return null
  return { text: cleanText(b[1] ?? ''), lineNo, raw, isTask: false, done: false }
}
function bulletsAfter(lines, headIdx) {
  const out = []
  for (let i = headIdx + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) { if (out.length) break; continue }
    const b = parseBullet(raw, i)
    if (!b) break
    out.push(b)
  }
  return out
}
function findLine(lines, re, from = 0, to = lines.length) { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1 }
function sectionRange(lines, headRe) {
  const start = findLine(lines, headRe); if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) { end = i; break }
  return [start, end]
}
function priorityOf(raw) { if (raw.includes('\u{1F534}')) return 3; if (raw.includes('\u{1F7E1}')) return 2; if (raw.includes('\u{1F7E2}')) return 1; return 0 }
function parseDailyNote(md) {
  const lines = md.split('\n').map(l => l.replace(/\r$/, ''))
  let tone = null
  const toneIdx = findLine(lines, /一句話定調/)
  if (toneIdx >= 0) { const after = lines[toneIdx].split(/→|->/).slice(1).join('→'); const t = cleanText(after.replace(/^>\s*/, '')); tone = t || null }
  let oneThing = null
  const oneIdx = findLine(lines, /唯一要務|The ONE Thing/i)
  if (oneIdx >= 0) oneThing = bulletsAfter(lines, oneIdx).find(b => b.text) ?? null
  const mitIdx = findLine(lines, /三件\s*MIT/i)
  const mits = mitIdx >= 0 ? bulletsAfter(lines, mitIdx).filter(b => b.text).map(b => ({ ...b, priority: priorityOf(b.raw) })) : []
  const anchorIdx = findLine(lines, /錨點時段/)
  const anchors = anchorIdx >= 0 ? bulletsAfter(lines, anchorIdx).filter(b => b.text).map(b => {
    const m = b.text.match(/^(\d{1,2}):(\d{2})\s*(?:[-–~]\s*\d{1,2}:\d{2})?\s*(.*)$/)
    if (!m) return { ...b, time: '' }
    return { ...b, time: `${m[1].padStart(2, '0')}:${m[2]}`, text: m[3].trim() || b.text }
  }) : []
  const capture = { total: 0, flash: 0, read: 0, task: 0 }
  const cap = sectionRange(lines, /^##\s.*捕捉軌/)
  if (cap) for (let i = cap[0] + 1; i < cap[1]; i++) {
    const raw = lines[i]; if (/^\s*>/.test(raw)) continue
    const b = parseBullet(raw, i); if (!b || !b.text) continue
    capture.total++; if (b.isTask) capture.task++; if (/#閃/.test(raw)) capture.flash++; if (/#讀/.test(raw)) capture.read++
  }
  const reflection = { filled: false, done: null }
  const ref = sectionRange(lines, /^##\s.*沉澱/)
  if (ref) for (let i = ref[0] + 1; i < ref[1]; i++) {
    const m = lines[i].match(/^\s*[-*]\s*\*\*(.+?)\*\*.*?[：:]\s*(.*)$/); if (!m) continue
    const val = cleanText(m[2]); if (!val) continue
    reflection.filled = true; if (/今天真正完成/.test(m[1])) reflection.done = val
  }
  // dailyOps.ts:20 hasMarker：`morning:: done` / `reviewed:: done`
  const hasMarker = (key) => new RegExp(`^${key}::\\s*done\\s*$`, 'm').test(md)
  return { tone, oneThing, mits, anchors, capture, reflection, morning: hasMarker('morning'), reviewed: hasMarker('reviewed') }
}

const VIEW = 'tw.scottchen.notegen-today.main'
const CMD = (s) => `tw.scottchen.notegen-today.${s}`
const CACHE_KEY = 'today.scan.v1'

let ctx, disposables = [], rendering = false, dirty = false, lastRenderAt = 0

export async function activate(context) {
  ctx = context
  disposables.push(
    ctx.commands.handle(CMD('open'),      () => ctx.ui.views.open(VIEW)),
    ctx.commands.handle(CMD('refresh'),   () => render({ force: true })),
    ctx.commands.handle(CMD('openDaily'), async () => ctx.notes.openOrCreate({ path: await dailyPath() })),
    ctx.commands.handle(CMD('morning'),   () => stamp('morning')),
    ctx.commands.handle(CMD('review'),    () => stamp('review')),
    ctx.commands.handle(CMD('openTask'),  (arg) => ctx.notes.openOrCreate({ path: arg.path })),
    ctx.notes.onDidChange(() => schedule()),
    ctx.workspace.onDidChange(() => render({ force: true })),
  )
  await render({ force: true })
  // 沙箱沒有 setTimeout / setInterval：時鐘只在 render 時更新，刷新靠「重新掃描」或筆記變更事件
}

export async function deactivate() {
  for (const d of disposables) d.dispose?.()
}

// 無 timer 的節流：render 進行中或 5 秒內的變更只記 dirty，render 結束後補一次
function schedule() {
  if (rendering || Date.now() - lastRenderAt < 5000) { dirty = true; return }
  void render({ force: true })
}

// ---------- 資料層（對應 signals.ts：只讀，不補假值） ----------
async function dailyPath() {
  const s = settings()
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  const name = s.dailyPattern.replace('YYYY', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('DD', p(d.getDate()))
  return `${s.dailyFolder}/${name}.md`
}
function settings() {
  const raw = ctx.settings ?? globalThis.__notegenSettings ?? {}
  const get = (k, d) => raw[`tw.scottchen.notegen-today.${k}`] ?? raw[k] ?? d
  return { dailyFolder: get('dailyFolder', '20 Journal/21 Daily'), inboxFolder: get('inboxFolder', '10 Inbox'), dailyPattern: get('dailyPattern', 'YYYYMMDD'), staleDays: Number(get('staleDays', 3)) }
}

// 主程式限制 120 RPC/秒（community-runtime.ts:49）。策略：
//  1) notes.search('- [ ]') 一次 RPC 找出含未完成任務的檔案（上限 100）
//  2) 只讀「新檔或 modifiedAt 有變」的檔案，讀取之間 sleep 25ms（≈40/秒）
//  3) 每次 render 最多讀 150 檔，其餘留到下一次；結果快取在 storage.workspace
const MAX_READS_PER_PASS = 40

async function scanTasks({ force }) {
  const cache = (await ctx.storage.workspace.get(CACHE_KEY)) ?? { files: {}, at: 0 }
  if (!force && Date.now() - cache.at < 10 * 60_000) return summarize(cache)

  // 候選檔：search 命中 ∪ 快取裡已知有任務的檔
  const candidates = new Map()
  try {
    const hit = await ctx.notes.search({ query: '- [ ]', limit: 100 })
    for (const m of (hit.matches ?? hit.results ?? hit.entries ?? [])) if (m.path && isTaskSource(m.path)) candidates.set(m.path, m.modifiedAt ?? null)
  } catch (e) { ctx.log.warning('notes.search 不可用，改走全掃：' + e.message) }
  for (const path of Object.keys(cache.files)) if (!candidates.has(path)) candidates.set(path, null)

  // 沒有 search 結果時才列整個 vault（分頁，每頁 1 RPC）
  if (candidates.size === 0) {
    let cursor
    do {
      const page = await ctx.notes.list({ folder: '', recursive: true, limit: 1000, cursor })
      for (const e of page.entries) if (e.path.endsWith('.md') && isTaskSource(e.path)) candidates.set(e.path, e.modifiedAt ?? null)
      cursor = page.nextCursor
    } while (cursor)
  }

  let reads = 0
  for (const [path, mtime] of candidates) {
    const prev = cache.files[path]
    if (prev && mtime !== null && prev.modifiedAt === mtime) continue      // 沒變，沿用
    if (reads >= MAX_READS_PER_PASS) { cache.partial = true; break }
    try {
      const { content } = await ctx.notes.read({ path })
      const tasks = []
      for (const line of content.split('\n')) {
        const t = parseTaskLine(line)
        if (t && !t.done) tasks.push({ text: t.text, due: t.due, priority: t.priority })
      }
      cache.files[path] = { modifiedAt: mtime, tasks }
    } catch { delete cache.files[path] }
    reads += 1
  }
  if (reads < MAX_READS_PER_PASS) cache.partial = false
  cache.at = Date.now()
  await ctx.storage.workspace.set(CACHE_KEY, cache)
  return summarize(cache)
}

function summarize(cache) {
  const now = new Date(), tasks = []
  for (const [path, f] of Object.entries(cache.files)) for (const t of f.tasks) tasks.push({ ...t, path, bucket: bucketFor(t, now) })
  return { tasks, scannedAt: cache.at, partial: !!cache.partial }
}

async function inboxStale() {
  const s = settings()
  let page
  try { page = await ctx.notes.list({ folder: s.inboxFolder, recursive: false, limit: 1000 }) }
  catch (e) { return { stale: null, total: null, hasTime: false, missing: true, folder: s.inboxFolder } }
  const limit = Date.now() - s.staleDays * 86_400_000
  // 待確認 A：notes.list 的 modifiedAt 為 optional；沒有時退回「只顯示總數」
  const withTime = page.entries.filter(e => typeof e.modifiedAt === 'number')
  return withTime.length ? { stale: withTime.filter(e => e.modifiedAt < limit).length, total: page.entries.length, hasTime: true }
                         : { stale: null, total: page.entries.length, hasTime: false }
}

async function loadDaily() {
  const path = await dailyPath()
  try { const { content } = await ctx.notes.read({ path }); return { path, exists: true, parsed: parseDailyNote(content) } }
  catch { return { path, exists: false, parsed: null } }
}

// dailyOps.ts:53-77 markDailyDone：寫 `morning:: done` / `reviewed:: done`；今日筆記不存在就拒絕，不自建空檔
async function stamp(kind) {
  const key = kind === 'morning' ? 'morning' : 'reviewed'
  const path = await dailyPath()
  let content
  try { ({ content } = await ctx.notes.read({ path })) }
  catch { ctx.ui.showNotice(`今日 Daily Note（${path}）還不存在：請先建立今日筆記再標記 ${key}`); return }
  if (new RegExp(`^${key}::\\s*done\\s*$`, 'm').test(content)) { ctx.ui.showNotice(`${key} 已是完成狀態`); return }
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  await ctx.notes.prepareForWrite({ path })
  await ctx.notes.write({ path, content: `${content.replace(/\s*$/, '')}${eol}${key}:: done${eol}` })
  ctx.ui.showNotice(`已標記 ${key} 完成`)
  await render({ force: false })
}

// ---------- 畫面層：宣告式 blocks（對應示意圖五張卡） ----------
async function render(opts) {
  if (rendering) { dirty = true; return }
  rendering = true
  try {
    // 第一幀：先用「快」資料畫出面板（daily note + inbox + records，共 3–4 個 RPC），任務掃描之後再補
    const [daily, inbox, records] = await Promise.all([
      loadDaily(),
      inboxStale(),
      ctx.records.list({ limit: 200 }).catch(() => ({ items: [] })),
    ])
    await paint({ daily, inbox, records, scan: { tasks: [], scannedAt: 0, pending: true } })
    // 第二幀：任務掃描（重）
    const scan = await scanTasks(opts).catch(e => { ctx.log.warning('scanTasks: ' + (e?.message ?? e)); return { tasks: [], scannedAt: 0, error: String(e?.message ?? e) } })
    await paint({ daily, inbox, records, scan })
  } catch (e) {
    ctx.log.error('render: ' + (e?.message ?? e))
    try { await ctx.ui.views.update(VIEW, { blocks: [{ type: 'callout', title: '今日面板發生錯誤', text: String(e?.message ?? e), tone: 'destructive' }, { type: 'actions', actions: [{ id: 'refresh', label: '重新掃描', command: CMD('refresh') }] }] }) } catch {}
  } finally {
    rendering = false; lastRenderAt = Date.now()
    if (dirty) { dirty = false; void render({ force: true }) }
  }
}

// 本週有哪幾天有 daily note（1 個 RPC；供「本週」列使用）
async function weekDailySet() {
  try {
    const page = await ctx.notes.list({ folder: settings().dailyFolder, recursive: false, limit: 1000 })
    return new Set(page.entries.map(e => e.name.replace(/\.md$/, '')))
  } catch { return new Set() }
}

async function paint({ daily, inbox, records, scan }) {
  const tasks = scan.tasks
  const overdue = tasks.filter(t => t.bucket === 'overdue'), today = tasks.filter(t => t.bucket === 'today')
  const attention = overdue.length + today.length
  const p = daily.parsed, now = new Date()
  const todayRecords = (records.items ?? []).filter(r => sameDay(new Date(r.createdAt ?? r.created ?? 0), now))
  const safe = (t, fallback = '—') => { const v = String(t ?? '').trim(); return v ? v.slice(0, 160) : fallback }

  // Timeline 列：錨點 + 「現在」+ 早晨 / 復盤標記，按時間排序
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const toMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null }
  const tl = []
  for (const a of (p?.anchors ?? [])) tl.push({ min: toMin(a.time), time: a.time || '', text: a.text, kind: 'anchor', done: a.done })
  if (p && !p.anchors?.some(a => /早晨啟動/.test(a.text))) tl.push({ min: 8 * 60, time: '08:00', text: '早晨啟動', kind: 'marker', done: p.morning })
  if (p && !p.anchors?.some(a => /復盤/.test(a.text))) tl.push({ min: 22 * 60, time: '22:00', text: '整日復盤', kind: 'marker', done: p.reviewed })
  tl.push({ min: nowMin, time: hhmm(), text: '現在', kind: 'now' })
  tl.sort((x, y) => (x.min ?? 9e9) - (y.min ?? 9e9))
  const glyph = (e) => e.kind === 'now' ? '◆' : e.done ? '✓' : (e.min !== null && e.min < nowMin) ? '·' : '○'
  const tlRows = tl.map(e => [glyph(e), e.time, e.kind === 'now' ? '現在' : e.text, e.kind === 'now' ? '' : e.done ? '已完成' : (e.min !== null && e.min < nowMin) ? '已過' : ''])

  // 本週列（一 … 日）
  const dayOfWeek = (now.getDay() + 6) % 7           // 週一 = 0
  const monday = new Date(now); monday.setDate(now.getDate() - dayOfWeek)
  const have = await weekDailySet()
  const weekCells = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const key = ymd(d).replace(/-/g, '')
    const label = `${d.getDate()}${have.has(key) ? ' ●' : ''}`
    weekCells.push(sameDay(d, now) ? `▸ ${label}` : label)
  }

  const blocks = [
    // 1 讀數列
    { type: 'heading', text: `${hhmm()}  ${ymd(now)} ${weekday(now)}` },
    scan.pending
      ? { type: 'text', text: '任務掃描中…', tone: 'muted' }
      : { type: 'text', text: `▲ 需處理 ${attention}   ·   逾期 ${overdue.length} · 今日 ${today.length}   ·   ${tasks.length} 項未完成`, tone: attention ? 'warning' : 'muted' },
    ...(scan.error ? [{ type: 'callout', title: '任務掃描失敗', text: scan.error, tone: 'destructive' }] : []),
    ...(scan.partial ? [{ type: 'text', text: '任務掃描尚未完成（分批進行中，按「重新掃描」補齊）', tone: 'muted' }] : []),
    // 2 需處理表（固定存在，讓 CSS 的 table 順序穩定）
    { type: 'table', id: 'attention', columns: ['', '任務', '來源'],
      rows: attention
        ? [...overdue, ...today].slice(0, 20).map(t => [t.bucket === 'overdue' ? '逾期' : '今日', { text: safe(t.title), command: CMD('openTask'), argument: { path: t.path } }, safe(t.path.split('/').pop())])
        : [[scan.pending ? '…' : '—', scan.pending ? '掃描中' : '沒有逾期或今日到期的任務', '']] },
    { type: 'separator' },

    // 3 今日錨點（Timeline）
    { type: 'heading', text: '今日錨點' },
    { type: 'table', id: 'timeline', columns: ['', '時間', '事項', ''], rows: tlRows.slice(0, 40) },
    { type: 'separator' },

    // 4 Daily Note（zebra rows）
    { type: 'heading', text: `Daily Note · ${daily.path.split('/').pop()}${daily.exists ? '' : '（尚未建立）'}` },
    { type: 'key-value', items: [
      { label: '一句話定調', value: p?.tone ? `「${p.tone}」` : '尚未填寫' },
      { label: '唯一要務', value: p?.oneThing?.text ?? '尚未填寫' },
      { label: '三件 MIT', value: p?.mits?.length ? p.mits.map(m => `${['', '🟢', '🟡', '🔴'][m.priority] || '·'} ${m.text}${m.done ? ' ✓' : ''}`).join('\n') : '尚未填寫' },
      { label: '捕捉軌',   value: p ? `${p.capture.total} 則 · 閃 ${p.capture.flash} · 讀 ${p.capture.read} · 任務 ${p.capture.task} · NoteGen 記錄 ${todayRecords.length}` : '—' },
      { label: 'Inbox',    value: inbox.missing ? `資料夾「${inbox.folder}」不存在 — 請到外掛設定改 Inbox 資料夾` : inbox.hasTime ? `${inbox.stale} 檔超過 ${settings().staleDays} 天（共 ${inbox.total}）` : `${inbox.total} 檔（此版 notes.list 無時間戳）` },
      { label: '沉澱',     value: p?.reflection?.filled ? (p.reflection.done ?? '已填寫') : '晚間 · 尚未填寫' },
    ].map(i => ({ label: i.label, value: String(i.value).slice(0, 2000) })) },
    { type: 'separator' },

    // 5 本週（● = 該日有 daily note，▸ = 今天）
    { type: 'heading', text: '本週' },
    { type: 'table', id: 'week', columns: ['一', '二', '三', '四', '五', '六', '日'], rows: [weekCells] },

    // 6 動作
    { type: 'actions', actions: [
      { id: 'morning', label: p?.morning ? '早晨啟動 ✓' : '早晨啟動', command: CMD('morning'), variant: 'secondary', disabled: !!p?.morning },
      { id: 'review',  label: p?.reviewed ? '整日復盤 ✓' : '整日復盤', command: CMD('review'),  variant: 'secondary', disabled: !!p?.reviewed },
      { id: 'daily',   label: '開啟 Daily Note', command: CMD('openDaily'), variant: 'default' },
      { id: 'refresh', label: '重新掃描', command: CMD('refresh'), variant: 'secondary' },
    ]},
  ]
  await ctx.ui.views.update(VIEW, { blocks })
  if (!scan.pending) { try { await ctx.ui.statusBar.update('tw.scottchen.notegen-today.attention', { text: `需處理 ${attention}` }) } catch (e) { ctx.log.warning('statusBar: ' + (e?.message ?? e)) } }
}

// ---------- 小工具 ----------
const pad = (n) => String(n).padStart(2, '0')
const hhmm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const weekday = (d) => '週日週一週二週三週四週五週六'.slice(d.getDay() * 2, d.getDay() * 2 + 2)
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const isPast = (t) => { if (!t) return false; const [h, m] = t.split(':').map(Number); const d = new Date(); return d.getHours() * 60 + d.getMinutes() > h * 60 + (m || 0) }
