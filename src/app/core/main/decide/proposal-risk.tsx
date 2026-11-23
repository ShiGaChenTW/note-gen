'use client'

// Fork（almanac ALMNC-65.1）：提案卡的風險標記與差異檢視（改了什麼）。
// 風險只由 lib/workbench/risk.ts 的 riskOf() 決定（動作類型＋改動內容，不問模型）。收合列只標「低風險」（多數提案都是高風險，全標會變成雜訊）；
// 展開後一律寫出風險等級與一句理由，下面逐檔列出前後差異（LCS 逐行比較，沒變的行摺起來）。沒有完整前後文的提案（新筆記、任務、時段）沿用原本的 DiffBlock。
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { changeRows, changeStats } from '@/lib/decide/change-diff'
import type { DecideItem } from '@/lib/decide/project'
import type { WorkbenchCard } from '@/lib/workbench/cards'
import { cardRisk, type ContentChange } from '@/lib/workbench/risk'
import { cn } from '@/lib/utils'
import { DiffBlock } from './decide-parts'

/** 一份改動預設最多列幾行（含摺疊列），其餘按「顯示全部」。 */
const ROW_LIMIT = 60

/** 收合列上的「低風險」小標；高風險或不是提案的卡不顯示。 */
export function RiskBadge({ card }: { card: WorkbenchCard }) {
  const t = useTranslations('workbench.risk')
  const risk = useMemo(() => (card.decide ? cardRisk(card) : null), [card])
  if (risk !== 'low') return null
  return <span className="rounded-(--r) bg-hover px-1.5 text-ui-numeric text-ink" data-testid="card-risk-badge">{t('low')}</span>
}

function changeLabel(t: ReturnType<typeof useTranslations>, change: ContentChange): string {
  if (change.target === 'domain') return t('domainOverview')
  if (change.target === 'memory') return change.path === 'context' ? t('memoryContext') : change.path
  return change.path
}

function ChangeDiff({ change, showPath }: { change: ContentChange, showPath: boolean }) {
  const t = useTranslations('workbench.risk')
  const [all, setAll] = useState(false)
  const rows = useMemo(() => changeRows(change.before, change.after), [change.before, change.after])
  const stats = useMemo(() => changeStats(change.before, change.after), [change.before, change.after])
  const shown = all ? rows : rows.slice(0, ROW_LIMIT)
  return (
    <div className="mt-2" data-testid="change-diff">
      <div className="flex items-baseline gap-2 text-xs">
        {showPath && <span className="min-w-0 truncate text-muted-ink" title={change.path}>{changeLabel(t, change)}</span>}
        {rows.length > 0 && <span className="font-mono text-ui-numeric text-faint tabular-nums">{t('stats', stats)}</span>}
      </div>
      {rows.length === 0
        ? <p className="mt-1 text-xs text-muted-ink">{t('noContent')}</p>
        : (
            <pre className="mt-1 overflow-x-auto rounded-(--r-kbd) border border-line-soft bg-bg px-3 py-2 font-mono text-ui-compact leading-6 whitespace-pre-wrap break-words">
              {shown.map((row, index) => {
                if (row.type === 'gap') return <div key={index} className="text-faint select-none">{t('unchanged', { count: row.count })}</div>
                if (row.type === 'remove') return <div key={index} className="text-muted-ink line-through">{`- ${row.text}`}</div>
                if (row.type === 'add') return <div key={index}><ins className="rounded-(--r-kbd) bg-ink/9 px-0.5 no-underline">{`+ ${row.text}`}</ins></div>
                return <div key={index} className="text-muted-ink">{`  ${row.text}`}</div>
              })}
            </pre>
          )}
      {rows.length > ROW_LIMIT && (
        <button type="button" className="mt-1 cursor-pointer text-xs text-muted-ink underline-offset-2 hover:text-ink hover:underline" onClick={() => setAll(value => !value)}>
          {all ? t('collapse') : t('showAll', { count: rows.length - ROW_LIMIT })}
        </button>
      )}
    </div>
  )
}

/** 展開後的風險說明＋差異檢視。 */
export function ProposalChanges({ card, item }: { card: WorkbenchCard, item: DecideItem }) {
  const t = useTranslations('workbench.risk')
  const risk = useMemo(() => cardRisk(card), [card])
  const changes = item.changes ?? []
  return (
    <section className="mt-2" data-testid="card-changes" data-risk={risk}>
      <p className="text-xs">
        <b className={cn('font-semibold', risk === 'low' ? 'text-ink' : 'text-muted-ink')}>{t(risk)}</b>
        <span className="ml-2 text-muted-ink">{t(risk === 'low' ? 'lowHint' : 'highHint')}</span>
      </p>
      {changes.length > 0
        ? changes.map((change, index) => <ChangeDiff key={`${change.target}:${change.path}:${index}`} change={change} showPath={changes.length > 1 || change.target !== 'note'} />)
        : item.preview.diff && <DiffBlock diff={item.preview.diff} className="mt-2" />}
    </section>
  )
}
