'use client'

// Fork（almanac ALMNC-69.9）：復原前版本檢查的比較卡——受影響的檔案在那之後被改過時，不直接覆蓋，
// 並排顯示「還原後」和「目前」，Scott 選「仍要復原」或「取消」（判斷規則提案第四節「衝突時」）。
// 兩欄只標出彼此不同的行（lib/git-versions/diff-lines）。
import { useTranslations } from 'next-intl'
import { diffLines } from '@/lib/git-versions/diff-lines'
import type { CompareFile } from '@/lib/ops/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  files: readonly CompareFile[]
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function Column({ label, lines, missing, side }: { label: string, lines: ReturnType<typeof diffLines> | null, missing: string, side: 'restored' | 'current' }) {
  const own = side === 'restored' ? 'add' : 'remove'
  return (
    <div className="min-w-0 flex-1 rounded-md border border-line bg-bg">
      <div className="border-b border-line px-2 py-1 text-xs font-medium">{label}</div>
      <pre data-side={side} className="max-h-64 overflow-auto p-2 font-mono text-xs whitespace-pre-wrap break-all">
        {lines === null
          ? <span className="text-muted-foreground">{missing}</span>
          : lines.filter(line => line.type === 'equal' || line.type === own).map((line, index) => (
              <div key={index} data-changed={line.type !== 'equal' || undefined} className={cn(line.type !== 'equal' && (side === 'restored' ? 'bg-success/15' : 'bg-destructive/10'))}>
                {line.text || ' '}
              </div>
            ))}
      </pre>
    </div>
  )
}

export function UndoCompareCard({ files, busy, onConfirm, onCancel }: Props) {
  const t = useTranslations('ops.compare')
  return (
    <section role="dialog" aria-label={t('title')} className="space-y-3 rounded-md border border-line bg-panel p-3 text-sm text-ink">
      <div>
        <div className="font-medium">{t('title')}</div>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      {files.map(file => {
        const lines = file.restored !== null && file.current !== null ? diffLines(file.current, file.restored) : null
        const only = (text: string | null) => text === null ? null : text.split('\n').map(line => ({ type: 'equal' as const, text: line }))
        return (
          <div key={file.path} className="space-y-1" data-path={file.path}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="break-all font-medium">{file.path}</span>
              {file.changed && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">{t('changed')}</span>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Column side="restored" label={t('restored')} missing={t('missing')} lines={lines ?? only(file.restored)} />
              <Column side="current" label={t('current')} missing={t('missing')} lines={lines ?? only(file.current)} />
            </div>
          </div>
        )
      })}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>{t('confirm')}</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </section>
  )
}
