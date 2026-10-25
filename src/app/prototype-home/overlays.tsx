'use client'
// PROTOTYPE: 三種首頁共用的浮層（草稿審核、知識報告、對話摘要預覽、編輯首頁）。
import { useState } from 'react'
import { X, AlertTriangle, Bot, Check } from 'lucide-react'
import { CARDS, CardKey, LEVELS, Level, draftChanges, report, summaryDraft } from './data'

export type Overlay = null | 'review' | 'report' | 'summary' | 'edit'

export function LevelBadge({ level, prev }: { level: Level; prev?: Level }) {
  const i = LEVELS.indexOf(level)
  const p = prev ? LEVELS.indexOf(prev) : i
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="flex gap-0.5">
        {LEVELS.map((_, k) => <span key={k} className={`h-1.5 w-3 rounded-sm ${k <= i ? 'bg-primary' : 'bg-secondary'}`} />)}
      </span>
      <span className="text-foreground">{level}</span>
      {i > p && <span className="text-emerald-400">↑</span>}
      {i < p && <span className="text-destructive">↓</span>}
    </span>
  )
}

function Shell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className={`h-full overflow-y-auto border-l border-border bg-background p-6 ${wide ? 'w-[760px]' : 'w-[560px]'}`} onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Review({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const bulk = draftChanges.filter(d => (d.kind === '新增' || d.kind === '修改') && !d.conflict)
  return (
    <Shell title="審核草稿：整理 Inbox（5 則）" onClose={onClose} wide>
      <p className="mb-4 text-sm text-muted-foreground">任務已完成，以下修改都還在草稿裡，vault 尚未變動。搬移、刪除與有衝突的項目要逐條確認。</p>
      <div className="space-y-2">
        {draftChanges.map(d => {
          const single = d.kind === '搬移' || d.kind === '刪除' || d.conflict
          return (
            <div key={d.id} className="rounded-md border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <span className={`rounded px-1.5 py-0.5 text-xs ${d.kind === '刪除' ? 'bg-destructive/20 text-destructive' : d.kind === '新增' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary'}`}>{d.kind}</span>
                <span className="flex-1 truncate font-mono text-sm">{d.path}</span>
                {single && <span className="text-xs text-primary">逐條確認</span>}
                <button onClick={() => setPicked(p => ({ ...p, [d.id]: !p[d.id] }))} className={`rounded px-2 py-1 text-xs ${picked[d.id] ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent'}`}>{picked[d.id] ? '已收下' : '收下'}</button>
              </div>
              <div className="mt-1.5 pl-1 text-xs text-muted-foreground">{d.summary}</div>
              {d.conflict && <div className="mt-2 flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1 text-xs text-primary"><AlertTriangle className="size-3.5" />任務執行期間這個檔案被手機修改過，請先看差異</div>}
              {d.id === 'd2' && (
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs leading-5"><span className="text-muted-foreground">  ## 延伸{'\n'}</span><span className="text-emerald-400">+ - [[Rust/借用與生命週期]]{'\n'}</span><span className="text-emerald-400">+ - 讀書會第 6 次討論</span></pre>
              )}
            </div>
          )
        })}
      </div>
      <div className="sticky bottom-0 mt-5 flex gap-2 border-t border-border bg-background pt-4">
        <button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">收下可整批的 {bulk.length} 項</button>
        <button className="rounded-md bg-secondary px-3 py-2 text-sm">只收下已勾選（{Object.values(picked).filter(Boolean).length}）</button>
        <button className="ml-auto rounded-md px-3 py-2 text-sm text-destructive hover:bg-accent">全部丟掉</button>
      </div>
    </Shell>
  )
}

function Report({ onClose }: { onClose: () => void }) {
  return (
    <Shell title={report.title} onClose={onClose} wide>
      <div className="mb-4 text-xs text-muted-foreground">{report.path} · 產出 {report.generatedAt} · 用量 {report.tokens} tokens · 報告不會修改任何筆記</div>
      <h3 className="mb-2 text-sm font-medium">各主題掌握度</h3>
      <div className="mb-6 divide-y divide-border rounded-md border border-border">
        {report.topics.map(t => (
          <div key={t.name} className="p-3">
            <div className="flex items-center gap-3">
              <span className="w-28 font-medium">{t.name}</span>
              <LevelBadge level={t.level} prev={t.prev} />
              <span className="ml-auto text-xs text-muted-foreground">{t.notes} 篇</span>
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">{t.gap}</div>
            <div className="mt-1 border-l-2 border-primary/50 pl-2 text-xs italic text-muted-foreground">{t.evidence}</div>
          </div>
        ))}
      </div>
      <h3 className="mb-2 text-sm font-medium">優化建議</h3>
      <div className="space-y-2">
        {report.suggestions.map(s => (
          <div key={s.id} className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-sm">
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{s.topic}</span>
            <span className={`flex-1 ${s.done ? 'text-muted-foreground line-through' : ''}`}>{s.text}</span>
            {s.done ? <Check className="size-4 text-emerald-400" /> : <button className="flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs hover:bg-accent"><Bot className="size-3.5" />交給 Agent</button>}
          </div>
        ))}
      </div>
    </Shell>
  )
}

function Summary({ onClose }: { onClose: () => void }) {
  return (
    <Shell title="對話摘要預覽" onClose={onClose}>
      <label className="text-xs text-muted-foreground">存放路徑</label>
      <input defaultValue={summaryDraft.path} className="mb-4 mt-1 w-full rounded-md border border-input bg-muted px-2 py-1.5 font-mono text-xs" />
      <pre className="mb-3 rounded bg-muted p-2 text-xs text-muted-foreground">---{'\n'}{summaryDraft.frontmatter}{'\n'}---</pre>
      {summaryDraft.sections.map(s => (
        <div key={s.h} className="mb-3">
          <div className={`mb-1 text-sm font-medium ${s.h === '我的觀點與理解' ? 'text-primary' : ''}`}>## {s.h}{s.h === '我的觀點與理解' && <span className="ml-2 text-xs font-normal text-muted-foreground">只收你說的，算進「內化」</span>}</div>
          <textarea defaultValue={s.body} rows={Math.max(2, s.body.split('\n').length)} className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm" />
        </div>
      ))}
      <div className="flex gap-2">
        <button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">存檔</button>
        <button onClick={onClose} className="rounded-md bg-secondary px-3 py-2 text-sm">取消</button>
      </div>
    </Shell>
  )
}

function EditHome({ onClose, enabled, setEnabled }: { onClose: () => void; enabled: Record<CardKey, boolean>; setEnabled: (e: Record<CardKey, boolean>) => void }) {
  return (
    <Shell title="編輯首頁" onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">開關卡片、拖曳排序（原型只做開關）。設定存在 app 端，不進 vault。</p>
      {CARDS.map(c => (
        <label key={c.key} className="flex cursor-pointer items-center justify-between border-b border-border py-2.5 text-sm">
          <span>⋮⋮ {c.name}</span>
          <input type="checkbox" checked={enabled[c.key]} onChange={e => setEnabled({ ...enabled, [c.key]: e.target.checked })} className="size-4 accent-[hsl(var(--primary))]" />
        </label>
      ))}
    </Shell>
  )
}

export function Overlays({ open, setOpen, enabled, setEnabled }: { open: Overlay; setOpen: (o: Overlay) => void; enabled: Record<CardKey, boolean>; setEnabled: (e: Record<CardKey, boolean>) => void }) {
  const close = () => setOpen(null)
  if (open === 'review') return <Review onClose={close} />
  if (open === 'report') return <Report onClose={close} />
  if (open === 'summary') return <Summary onClose={close} />
  if (open === 'edit') return <EditHome onClose={close} enabled={enabled} setEnabled={setEnabled} />
  return null
}
