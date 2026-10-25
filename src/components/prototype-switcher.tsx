'use client'
// PROTOTYPE: 原型用的版型切換列，正式功能不要引用。
import { useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function PrototypeSwitcher({ variants }: { variants: { key: string; name: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const current = params.get('variant') ?? variants[0].key
  const index = Math.max(0, variants.findIndex(v => v.key === current))

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length]
    const sp = new URLSearchParams(params.toString())
    sp.set('variant', next.key)
    router.replace(`${pathname}?${sp.toString()}`)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (process.env.NODE_ENV === 'production') return null
  return (
    <div className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-fuchsia-400 bg-white px-2 py-1 text-sm font-medium text-black shadow-2xl">
      <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-black/10"><ChevronLeft className="size-4" /></button>
      <span className="min-w-48 text-center">{variants[index].key}（{variants[index].name}）</span>
      <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-black/10"><ChevronRight className="size-4" /></button>
    </div>
  )
}
