'use client'

// Fork（#31）：編輯首頁——開關卡片、拖曳或上下移排序、啟動時是否顯示首頁。
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { isCardVisible, moveCardBy, moveCardTo, setCardVisible } from '@/lib/home/cards'
import useHomeStore from '@/stores/home'
import { HOME_CARDS } from './home-cards'

export function HomeEditSheet() {
  const t = useTranslations('home')
  const { editing, setEditing, prefs, setPrefs, showOnStartup, setShowOnStartup } = useHomeStore()
  const [dragging, setDragging] = useState<string | null>(null)
  const byKey = new Map(HOME_CARDS.map(card => [card.key, card]))
  const ordered = prefs.order.map(key => byKey.get(key)).filter(card => card !== undefined)

  return (
    <Sheet open={editing} onOpenChange={setEditing}>
      <SheetContent side="right" className="flex w-[420px] flex-col gap-0 p-5 sm:max-w-[420px]">
        <SheetHeader className="mb-4 p-0">
          <SheetTitle>{t('edit')}</SheetTitle>
          <SheetDescription>{t('editDescription')}</SheetDescription>
        </SheetHeader>
        <ul className="grid gap-1" aria-label={t('cardsLabel')}>
          {ordered.map((card, index) => (
            <li
              key={card.key}
              draggable
              onDragStart={event => { setDragging(card.key); event.dataTransfer.effectAllowed = 'move' }}
              onDragOver={event => { if (dragging) event.preventDefault() }}
              onDrop={event => {
                event.preventDefault()
                if (dragging) void setPrefs(moveCardTo(prefs, dragging, card.key))
                setDragging(null)
              }}
              onDragEnd={() => setDragging(null)}
              className={`flex items-center gap-2 rounded-md border px-2 py-2 ${dragging === card.key ? 'opacity-50' : ''}`}
            >
              <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden />
              <span className="flex-1 text-sm">{t(`cards.${card.key}`)}</span>
              <Button variant="ghost" size="icon" className="size-7" disabled={index === 0} onClick={() => void setPrefs(moveCardBy(prefs, card.key, -1))} aria-label={t('moveUp')}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" disabled={index === ordered.length - 1} onClick={() => void setPrefs(moveCardBy(prefs, card.key, 1))} aria-label={t('moveDown')}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Switch
                checked={isCardVisible(prefs, card)}
                onCheckedChange={checked => void setPrefs(setCardVisible(prefs, card, checked))}
                aria-label={t(`cards.${card.key}`)}
              />
            </li>
          ))}
        </ul>
        <label className="mt-6 flex items-center justify-between gap-3 border-t pt-4 text-sm">
          <span>{t('showOnStartup')}</span>
          <Switch checked={showOnStartup} onCheckedChange={checked => void setShowOnStartup(checked)} />
        </label>
      </SheetContent>
    </Sheet>
  )
}
