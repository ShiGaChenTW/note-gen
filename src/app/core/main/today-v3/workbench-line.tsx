'use client'

// Fork（almanac ALMNC-54.14）：今天頁的「工作台 · N 件」（定案文件第四節「與今天頁的關係」）。
// 放在副標裡（ALMNC-37：狀態放副標），接在日期與到期摘要後面；點了就跳到工作台的審核分頁。
// N＝工作台等你處理的件數（先放著的不算），和側欄同一個數字；N＝0 時不顯示，和副標的「N 項到期」一樣（0 就不寫）。
import { useTranslations } from 'next-intl'
import { openWorkbench } from '@/lib/workbench/open'

export function WorkbenchLine({ count }: { count: number }) {
  const t = useTranslations('todayV3.workbench')
  if (count <= 0) return null
  return (
    <button
      type="button"
      data-testid="today-v3-workbench"
      onClick={() => openWorkbench('review')}
      aria-label={t('open', { count })}
      className="cursor-pointer rounded-(--r-kbd) text-ink tabular-nums outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring/65"
    >
      {t('line', { count })}
    </button>
  )
}
