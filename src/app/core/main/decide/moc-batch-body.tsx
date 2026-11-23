'use client'

// Fork（almanac ALMNC-69.10）：整批檢查卡的內容——依 MOC 分組列出每一條差異，每條可以「取消這條」（再按一次恢復）。
// 按鈕（全部接受／全部取消）在卡片下方，動作在 use-card-actions（lib/moc/reconcile-runtime settleMocBatch）。
import { useTranslations } from 'next-intl'
import type { EffectiveDiff } from '@/lib/moc/reconcile'
import { cn } from '@/lib/utils'
import useMocReconcileStore from '@/stores/moc-reconcile'
import { V3_BUTTON_SHAPE } from '@/components/v3/button-shape'

// 同 review-card 的 BTN（不從那裡 import，避免循環引用）。
const BTN = `${V3_BUTTON_SHAPE} inline-flex shrink-0 cursor-pointer items-center border border-line bg-bg px-3 text-ui-compact font-medium text-ink outline-none transition-colors duration-100 hover:bg-hover focus-visible:ring-1 focus-visible:ring-ink/60`

function noteName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

function DiffText({ diff }: { diff: EffectiveDiff }) {
  const t = useTranslations('workbench.mocBatch')
  const chapter = (title: string) => title || t('unsorted')
  switch (diff.kind) {
    case 'remove': return <>{t('diff.remove', { note: noteName(diff.notePath), chapter: chapter(diff.chapterTitle) })}</>
    case 'add': return <>{t('diff.add', { note: noteName(diff.notePath), chapter: chapter(diff.chapterTitle) })}</>
    case 'move': return <>{t('diff.move', { note: noteName(diff.notePath), from: chapter(diff.fromChapterTitle), to: chapter(diff.toChapterTitle) })}</>
    case 'relation': return <>{t('diff.relation', { note: noteName(diff.notePath), after: diff.after })}</>
    case 'chapter-rename': return <>{t('diff.chapter-rename', { before: diff.before, after: diff.after })}</>
  }
}

export function MocBatchBody() {
  const t = useTranslations('workbench.mocBatch')
  const pending = useMocReconcileStore(state => state.pending)
  const cancelled = useMocReconcileStore(state => state.cancelled)
  const toggle = useMocReconcileStore(state => state.toggleCancelled)
  if (!pending) return null
  const groups = pending.mocs.map(item => ({ path: item.path, name: item.result.mocName, diffs: pending.diffs.filter(diff => diff.mocPath === item.path) }))
  return (
    <div className="text-ui-compact leading-6 text-muted-ink" data-testid="moc-batch-body">
      <p>{t('body')}</p>
      {groups.filter(group => group.diffs.length).map(group => (
        <section key={group.path} className="mt-3">
          <h4 className="text-xs font-semibold text-ink" title={group.path}>{group.name}</h4>
          <ul className="mt-1 divide-y divide-line-soft rounded-(--r) border border-line-soft">
            {group.diffs.map(diff => {
              const off = cancelled.includes(diff.id)
              return (
                <li key={diff.id} className="flex items-center gap-3 px-3 py-1.5" data-diff={diff.kind} data-cancelled={off || undefined}>
                  <span className={cn('min-w-0 flex-1 break-words text-ink', off && 'text-faint line-through')}><DiffText diff={diff} /></span>
                  {off && <span className="text-xs text-faint">{t('cancelled')}</span>}
                  <button type="button" className={BTN} onClick={() => toggle(diff.id)} aria-pressed={off}>{off ? t('restore') : t('cancel')}</button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {pending.notices.length > 0 && <p className="mt-2 text-xs">{t('notices', { count: pending.notices.length })}</p>}
    </div>
  )
}
