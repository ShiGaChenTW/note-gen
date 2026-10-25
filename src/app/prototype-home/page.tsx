'use client'
// PROTOTYPE: Phase 3 首頁三種版型，用 ?variant=A|B|C 切換（← → 鍵也可以）。
// 全部假資料、沒有任何寫入；定案後整個資料夾移到 throwaway 分支，不進 dev。
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PrototypeSwitcher } from '@/components/prototype-switcher'
import { CARDS, CardKey } from './data'
import { Overlay, Overlays } from './overlays'
import { VariantA, VariantB, VariantC, VariantD, VariantE } from './variants'

const VARIANTS = [
  { key: 'A', name: 'Bento 卡片牆' },
  { key: 'B', name: '收件匣工作台' },
  { key: 'C', name: '今日時間軸' },
  { key: 'D', name: 'B+C：清單為主' },
  { key: 'E', name: 'B+C：時間軸為主' },
]

// 取自 personal/notegen-obsidian-baseline.css 的深色琥珀主題
const THEME = `
.proto-root {
  --background: 0 0% 12.5%; --foreground: 0 0% 85.5%;
  --card: 0 0% 14.9%; --card-foreground: 0 0% 85.5%;
  --primary: 43 96% 56%; --primary-foreground: 0 0% 9.8%;
  --secondary: 0 0% 20.4%; --secondary-foreground: 0 0% 85.5%;
  --muted: 0 0% 14.9%; --muted-foreground: 0 0% 60.4%;
  --accent: 0 0% 18.8%; --accent-foreground: 0 0% 90.2%;
  --destructive: 3 72% 64%; --border: 0 0% 18.4%; --input: 0 0% 22.7%;
  background: #161616; color: hsl(var(--foreground)); min-height: 100vh;
}`

function Prototype() {
  const variant = useSearchParams().get('variant') ?? 'A'
  const [open, setOpen] = useState<Overlay>(null)
  const [enabled, setEnabled] = useState(() => Object.fromEntries(CARDS.map(c => [c.key, c.defaultOn])) as Record<CardKey, boolean>)
  const props = { enabled, setOpen }
  return (
    <div className="proto-root dark pb-20">
      <style>{THEME}</style>
      {variant === 'A' && <VariantA {...props} />}
      {variant === 'B' && <VariantB {...props} />}
      {variant === 'C' && <VariantC {...props} />}
      {variant === 'D' && <VariantD {...props} />}
      {variant === 'E' && <VariantE {...props} />}
      <Overlays open={open} setOpen={setOpen} enabled={enabled} setEnabled={setEnabled} />
      <div className="fixed bottom-16 left-1/2 z-[100] -translate-x-1/2 rounded bg-black/70 px-2 py-1 font-mono text-[11px] text-white/70">
        開啟中的卡片：{CARDS.filter(c => enabled[c.key]).map(c => c.name).join('、')}{open ? ` · 浮層：${open}` : ''}
      </div>
      <PrototypeSwitcher variants={VARIANTS} />
    </div>
  )
}

export default function Page() {
  return <Suspense><Prototype /></Suspense>
}
