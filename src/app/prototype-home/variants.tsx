'use client'
// PROTOTYPE: 首頁三種版型。A = Bento 卡片牆、B = 收件匣工作台、C = 今日時間軸。
import { Bot, Calendar, CheckCircle2, Circle, Clock, FileText, Inbox, MessageSquare, Pause, Play, Search, Settings2, Sparkles, TriangleAlert } from 'lucide-react'
import { CardKey, agentTasks, conversations, events, footprint, recentNotes, report, signals, today, todos } from './data'
import { LevelBadge, Overlay } from './overlays'

type Props = { enabled: Record<CardKey, boolean>; setOpen: (o: Overlay) => void }

const stateStyle: Record<string, string> = {
  等你回應: 'text-primary',
  進行中: 'text-sky-400',
  沒做完: 'text-destructive',
  已完成: 'text-emerald-400',
}

function Header({ setOpen, subtitle }: { setOpen: Props['setOpen']; subtitle?: string }) {
  return (
    <div className="flex items-center gap-4 border-b border-border px-6 py-3">
      <div>
        <div className="text-lg font-semibold">首頁</div>
        <div className="text-xs text-muted-foreground">{today.date} {today.weekday} · {subtitle ?? '第二大腦 · 個人資料 · 日程'}</div>
      </div>
      <div className="ml-6 flex flex-1 items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground"><Search className="size-4" />搜尋筆記…</div>
      <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">⌘⇧H 回工作區</span>
      <button onClick={() => setOpen('edit')} className="flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1.5 text-sm hover:bg-accent"><Settings2 className="size-4" />編輯首頁</button>
    </div>
  )
}

function Card({ title, icon, children, className = '', action }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={`rounded-lg border border-border bg-card p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">{icon}{title}<div className="ml-auto">{action}</div></div>
      {children}
    </section>
  )
}

function TodoRow({ t }: { t: typeof todos[number] }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <Circle className="size-3.5 text-muted-foreground" />
      <span className="flex-1">{t.text}</span>
      {t.time && <span className="text-xs text-muted-foreground">⏰ {t.time}</span>}
      <span className={`text-xs ${t.overdueDays ? 'text-destructive' : 'text-muted-foreground'}`}>{t.overdueDays ? `逾期 ${t.overdueDays} 天` : t.due}</span>
    </div>
  )
}

function CaptureBox({ big }: { big?: boolean }) {
  return (
    <div>
      <input placeholder="想到什麼就記下來… Enter 存進 Inbox/，以「- [ ]」開頭變成今日待辦" className={`w-full rounded-md border border-input bg-muted px-3 ${big ? 'py-3 text-base' : 'py-2 text-sm'}`} />
      <div className="mt-1.5 text-xs text-muted-foreground">Inbox 目前 {report.stats.inbox} 則</div>
    </div>
  )
}

function TaskList({ setOpen }: { setOpen: Props['setOpen'] }) {
  return (
    <div className="space-y-1.5">
      {agentTasks.map(t => (
        <button key={t.id} onClick={() => t.state === '等你回應' && setOpen('review')} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-accent">
          <span className={`w-16 shrink-0 text-xs ${stateStyle[t.state]}`}>{t.state}</span>
          <span className="flex-1 truncate">{t.title}</span>
          <span className="text-xs text-muted-foreground">{t.detail}</span>
          {t.state === '沒做完' && <span className="flex items-center gap-0.5 text-xs text-primary"><Play className="size-3" />繼續</span>}
          {t.state === '進行中' && <Pause className="size-3.5 text-muted-foreground" />}
        </button>
      ))}
    </div>
  )
}

function Conversations({ setOpen }: { setOpen: Props['setOpen'] }) {
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="mb-1 text-xs text-muted-foreground">最近對話</div>
      {conversations.map(c => (
        <div key={c.id} className="flex items-center gap-2 py-1 text-sm">
          <MessageSquare className="size-3.5 text-muted-foreground" />
          <span className="flex-1 truncate">{c.title}</span>
          <span className="text-xs text-muted-foreground">{c.when}</span>
          {c.summarized ? <span className="text-xs text-emerald-400">已摘要</span> : <button onClick={() => setOpen('summary')} className="rounded bg-secondary px-1.5 py-0.5 text-xs hover:bg-accent">摘要</button>}
        </div>
      ))}
    </div>
  )
}

function SignalList({ limit = 5 }: { limit?: number }) {
  return (
    <div className="space-y-1">
      {signals.slice(0, limit).map(s => (
        <div key={s.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
          <Sparkles className="size-3.5 text-primary" />
          <span className="flex-1">{s.text}</span>
          <button className="flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs" title={s.prompt}><Bot className="size-3" />交給 Agent</button>
        </div>
      ))}
    </div>
  )
}

function ReportMini({ setOpen, compact }: { setOpen: Props['setOpen']; compact?: boolean }) {
  const moved = report.topics.filter(t => t.level !== t.prev)
  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">{report.title} · 下一期 W44 產出中</div>
      {(compact ? moved : report.topics).map(t => (
        <div key={t.name} className="flex items-center gap-2 py-1 text-sm"><span className="w-24">{t.name}</span><LevelBadge level={t.level} prev={t.prev} /></div>
      ))}
      {!compact && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {report.suggestions.filter(s => !s.done).slice(0, 3).map(s => <div key={s.id} className="text-xs text-muted-foreground">• {s.text}</div>)}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button onClick={() => setOpen('report')} className="rounded bg-secondary px-2 py-1 text-xs hover:bg-accent">看完整報告</button>
        <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">立即產生</button>
      </div>
    </div>
  )
}

function Footprint() {
  const max = Math.max(...footprint.map(f => f.write + f.edit + f.reread))
  return (
    <div className="flex h-24 items-end gap-2">
      {footprint.map(f => (
        <div key={f.day} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${((f.write + f.edit + f.reread) / max) * 72}px` }}>
            <div className="bg-primary" style={{ flex: f.write }} /><div className="bg-primary/50" style={{ flex: f.edit }} /><div className="bg-secondary" style={{ flex: f.reread }} />
          </div>
          <span className="text-xs text-muted-foreground">{f.day}</span>
        </div>
      ))}
    </div>
  )
}

function Health() {
  const s = report.stats
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {[['缺連結', s.unlinked], ['孤立筆記', s.orphans], ['Inbox', s.inbox]].map(([k, v]) => (
        <div key={k} className="rounded bg-muted py-2"><div className="text-lg font-semibold">{v}</div><div className="text-xs text-muted-foreground">{k}</div></div>
      ))}
    </div>
  )
}

function Schedule() {
  return (
    <div>
      {events.map(e => (
        <div key={e.time} className="flex items-center gap-2 py-1 text-sm"><span className="w-12 text-xs text-muted-foreground">{e.time}</span><span className="h-4 w-0.5 bg-sky-400" />{e.title}</div>
      ))}
      <div className="mt-2 border-t border-border pt-2">{todos.map(t => <TodoRow key={t.id} t={t} />)}</div>
    </div>
  )
}

/* ---------- A：Bento 卡片牆 ---------- */
export function VariantA({ enabled, setOpen }: Props) {
  return (
    <div>
      <Header setOpen={setOpen} />
      <div className="grid grid-cols-12 gap-4 p-6">
        {enabled.capture && <Card title="快速記錄" icon={<Inbox className="size-4" />} className="col-span-12"><CaptureBox big /></Card>}
        {enabled.schedule && <Card title="日程" icon={<Calendar className="size-4" />} className="col-span-4 row-span-2"><Schedule /></Card>}
        {enabled.report && <Card title="知識報告" icon={<FileText className="size-4" />} className="col-span-5 row-span-2"><ReportMini setOpen={setOpen} /></Card>}
        {enabled.tasks && <Card title="Agent 任務" icon={<Bot className="size-4" />} className="col-span-3 row-span-2"><TaskList setOpen={setOpen} /><Conversations setOpen={setOpen} /></Card>}
        {enabled.signals && <Card title="可以交給 Agent" icon={<Sparkles className="size-4" />} className="col-span-7"><SignalList /></Card>}
        {enabled.recent && (
          <Card title="最近筆記" icon={<FileText className="size-4" />} className="col-span-5">
            <div className="mb-2 rounded bg-muted p-3"><div className="text-sm font-medium">{recentNotes[0].title}</div><div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{recentNotes[0].excerpt}</div></div>
            {recentNotes.slice(1).map(n => <div key={n.title} className="flex py-0.5 text-sm"><span className="flex-1">{n.title}</span><span className="text-xs text-muted-foreground">{n.when}</span></div>)}
          </Card>
        )}
        {enabled.footprint && <Card title="本週足跡" icon={<Clock className="size-4" />} className="col-span-6"><Footprint /></Card>}
        {enabled.health && <Card title="知識庫健康" icon={<TriangleAlert className="size-4" />} className="col-span-6"><Health /></Card>}
      </div>
    </div>
  )
}

/* ---------- B：收件匣工作台（單一「需要你處理」清單 + 右側欄） ---------- */
export function VariantB({ enabled, setOpen }: Props) {
  type Item = { kind: string; text: string; meta: string; act: string; onClick?: () => void; tone: string }
  const items: Item[] = [
    ...(enabled.tasks ? agentTasks.filter(t => t.state === '等你回應' || t.state === '沒做完').map(t => ({ kind: t.state === '等你回應' ? '待審草稿' : '沒做完', text: t.title, meta: t.detail, act: t.state === '等你回應' ? '審核' : '繼續', onClick: () => setOpen('review'), tone: stateStyle[t.state] })) : []),
    ...(enabled.schedule ? todos.filter(t => t.overdueDays).map(t => ({ kind: '逾期待辦', text: t.text, meta: `逾期 ${t.overdueDays} 天 · ${t.note}`, act: '完成', tone: 'text-destructive' })) : []),
    ...(enabled.report ? report.suggestions.filter(s => !s.done).map(s => ({ kind: '優化建議', text: s.text, meta: `${s.topic} · ${report.title}`, act: '交給 Agent', tone: 'text-primary' })) : []),
    ...(enabled.signals ? signals.filter(s => s.id !== 'g2' && s.id !== 'g4').map(s => ({ kind: '提醒', text: s.text, meta: '規則提醒', act: '交給 Agent', tone: 'text-muted-foreground' })) : []),
    ...(enabled.tasks ? conversations.filter(c => !c.summarized).map(c => ({ kind: '未摘要對話', text: c.title, meta: c.when, act: '摘要', onClick: () => setOpen('summary'), tone: 'text-muted-foreground' })) : []),
  ]
  return (
    <div>
      <Header setOpen={setOpen} subtitle={`需要你處理 ${items.length} 項`} />
      <div className="flex gap-6 p-6">
        <div className="flex-1">
          {enabled.capture && <div className="mb-5"><CaptureBox /></div>}
          <div className="mb-2 text-sm font-medium">需要你處理</div>
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`w-20 shrink-0 text-xs ${it.tone}`}>{it.kind}</span>
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{it.text}</div><div className="text-xs text-muted-foreground">{it.meta}</div></div>
                <button onClick={it.onClick} className="rounded bg-secondary px-2.5 py-1 text-xs hover:bg-accent">{it.act}</button>
              </div>
            ))}
          </div>
          {enabled.recent && (
            <div className="mt-6">
              <div className="mb-2 text-sm font-medium">最近筆記</div>
              <div className="grid grid-cols-5 gap-2">{recentNotes.map(n => <div key={n.title} className="rounded-md border border-border bg-card p-2.5"><div className="truncate text-sm">{n.title}</div><div className="text-xs text-muted-foreground">{n.when}</div></div>)}</div>
            </div>
          )}
        </div>
        <aside className="w-80 shrink-0 space-y-4">
          {enabled.schedule && <Card title="今天" icon={<Calendar className="size-4" />}><Schedule /></Card>}
          {enabled.tasks && <Card title="背景任務" icon={<Bot className="size-4" />}><TaskList setOpen={setOpen} /></Card>}
          {enabled.report && <Card title="掌握度變化" icon={<FileText className="size-4" />}><ReportMini setOpen={setOpen} compact /></Card>}
          {enabled.footprint && <Card title="本週足跡" icon={<Clock className="size-4" />}><Footprint /></Card>}
          {enabled.health && <Card title="知識庫健康" icon={<TriangleAlert className="size-4" />}><Health /></Card>}
        </aside>
      </div>
    </div>
  )
}

/* ---------- C：今日時間軸（指令列 + 主題條 + 一天的時間軸） ---------- */
export function VariantC({ enabled, setOpen }: Props) {
  type Slot = { time: string; kind: 'event' | 'todo' | 'task' | 'now'; text: string; meta?: string; onClick?: () => void }
  const slots: Slot[] = [
    ...(enabled.schedule ? events.map(e => ({ time: e.time, kind: 'event' as const, text: e.title, meta: `${e.time}–${e.end} · ${e.calendar}` })) : []),
    ...(enabled.schedule ? todos.filter(t => t.time).map(t => ({ time: t.time!, kind: 'todo' as const, text: t.text, meta: '⏰ 待辦' })) : []),
    ...(enabled.tasks ? [
      { time: '09:40', kind: 'task' as const, text: '「整理 Inbox」完成，草稿 6 項待審', meta: 'Agent 任務', onClick: () => setOpen('review') },
      { time: '13:00', kind: 'task' as const, text: '預計：W44 知識報告產出完成', meta: 'Agent 任務 · 62%' },
    ] : []),
    { time: '11:24', kind: 'now', text: '現在' },
  ].sort((a, b) => a.time.localeCompare(b.time))
  const dot: Record<Slot['kind'], string> = { event: 'bg-sky-400', todo: 'bg-foreground', task: 'bg-primary', now: 'bg-destructive' }
  return (
    <div>
      <div className="border-b border-border px-6 py-5">
        <div className="mb-3 flex items-baseline gap-3">
          <div className="text-2xl font-semibold">{today.weekday}，10 月 26 日</div>
          <div className="text-sm text-muted-foreground">{today.week} · 3 個行程 · {todos.length} 件待辦 · 1 份草稿等你</div>
          <button onClick={() => setOpen('edit')} className="ml-auto flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1.5 text-sm hover:bg-accent"><Settings2 className="size-4" />編輯首頁</button>
        </div>
        {enabled.capture && (
          <div className="flex items-center gap-2 rounded-lg border border-input bg-muted px-3 py-2.5">
            <span className="text-primary">›</span>
            <input placeholder="記一筆（存進 Inbox）· 輸入 / 交代 Agent 背景去做 · ⌘K 搜尋" className="flex-1 bg-transparent text-sm outline-none" />
            <span className="text-xs text-muted-foreground">Enter 記錄 · ⌘Enter 交給 Agent</span>
          </div>
        )}
        {enabled.report && (
          <div className="mt-3 flex items-center gap-2 overflow-x-auto">
            <span className="shrink-0 text-xs text-muted-foreground">掌握度</span>
            {report.topics.map(t => (
              <button key={t.name} onClick={() => setOpen('report')} className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1 hover:bg-accent"><span className="text-sm">{t.name}</span><LevelBadge level={t.level} prev={t.prev} /></button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-8 px-6 py-5">
        <div className="flex-1">
          {enabled.schedule && todos.some(t => t.overdueDays) && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{todos.filter(t => t.overdueDays).map(t => <div key={t.id}>逾期：{t.text}（{t.overdueDays} 天）</div>)}</div>
          )}
          <div className="relative border-l border-border pl-6">
            {slots.map((s, i) => (
              <div key={i} className={`relative mb-4 ${s.kind === 'now' ? 'text-destructive' : ''}`} onClick={s.onClick}>
                <span className={`absolute -left-[29px] top-1.5 size-2.5 rounded-full ${dot[s.kind]}`} />
                <div className="flex items-baseline gap-3">
                  <span className="w-12 text-xs text-muted-foreground">{s.time}</span>
                  {s.kind === 'now' ? <div className="h-px flex-1 bg-destructive/60" /> : (
                    <div className={`flex-1 rounded-md px-3 py-2 ${s.kind === 'task' ? 'cursor-pointer border border-primary/40 bg-primary/5' : 'bg-card'}`}>
                      <div className="text-sm">{s.text}</div><div className="text-xs text-muted-foreground">{s.meta}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {enabled.schedule && (
            <div className="mt-2"><div className="mb-1 text-xs text-muted-foreground">今天沒有時間的待辦</div>{todos.filter(t => !t.time && !t.overdueDays).map(t => <TodoRow key={t.id} t={t} />)}</div>
          )}
        </div>
        <aside className="w-96 shrink-0 space-y-5">
          {enabled.signals && <div><div className="mb-1.5 text-sm font-medium">可以交給 Agent</div><SignalList limit={4} /></div>}
          {enabled.tasks && <div><div className="mb-1.5 text-sm font-medium">背景任務</div><TaskList setOpen={setOpen} /><Conversations setOpen={setOpen} /></div>}
          {enabled.recent && <div><div className="mb-1.5 text-sm font-medium">最近筆記</div>{recentNotes.map(n => <div key={n.title} className="flex items-center gap-2 py-0.5 text-sm"><CheckCircle2 className="size-3 text-muted-foreground" /><span className="flex-1">{n.title}</span><span className="text-xs text-muted-foreground">{n.when}</span></div>)}</div>}
          {enabled.footprint && <div><div className="mb-1.5 text-sm font-medium">本週足跡</div><Footprint /></div>}
          {enabled.health && <div><div className="mb-1.5 text-sm font-medium">知識庫健康</div><Health /></div>}
        </aside>
      </div>
    </div>
  )
}
