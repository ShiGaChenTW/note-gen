'use client'

// Fork（#31）：首頁。蓋在三欄工作區上方（不卸載工作區），⌘⇧H 切換。
// 版型 D：頂部列＋指令區、主欄、右欄；卡片由 home-cards.tsx 登記。
import { Fragment } from 'react'
import { useTranslations } from 'next-intl'
import { PanelsTopLeft, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cardsForSlot, type HomeSlot } from '@/lib/home/cards'
import useHomeStore from '@/stores/home'
import { TodayProvider, TodayTitle } from '../today/today-page'
import { HOME_CARDS } from './home-cards'
import { HomeEditSheet } from './home-edit-sheet'

function Slot({ slot, className }: { slot: HomeSlot; className?: string }) {
  const prefs = useHomeStore(state => state.prefs)
  const cards = cardsForSlot(HOME_CARDS, prefs, slot)
  if (!cards.length) return null
  return (
    <div className={className}>
      {cards.map(card => {
        const Render = card.slots[slot]!
        return <Fragment key={card.key}><Render /></Fragment>
      })}
    </div>
  )
}

export function HomeScreen() {
  const t = useTranslations('home')
  const visible = useHomeStore(state => state.visible)
  const loaded = useHomeStore(state => state.loaded)
  const hide = useHomeStore(state => state.hide)
  const setEditing = useHomeStore(state => state.setEditing)
  if (!loaded || !visible) return null

  return (
    <div className="absolute inset-x-0 top-0 bottom-7 z-30 overflow-y-auto bg-card" role="region" aria-label={t('title')}>
      <TodayProvider onNavigate={hide}>
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-5">
          <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <TodayTitle />
            <Slot slot="header" className="flex flex-wrap items-center gap-3" />
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={hide} title={t('backToWorkspace')}>
                <PanelsTopLeft className="size-4" aria-hidden />
                {t('backToWorkspace')}
                <kbd className="rounded border px-1 text-[11px]">⌘⇧H</kbd>
              </Button>
              <Button variant="secondary" className="gap-2" onClick={() => setEditing(true)}>
                <Settings2 className="size-4" aria-hidden />{t('edit')}
              </Button>
            </div>
          </header>

          <Slot slot="top" className="flex flex-col gap-3" />

          <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4 max-[1100px]:grid-cols-1">
            <Slot slot="main" className="flex min-w-0 flex-col gap-4" />
            <Slot slot="side" className="flex min-w-0 flex-col gap-4" />
          </div>
        </div>
      </TodayProvider>
      <HomeEditSheet />
    </div>
  )
}
