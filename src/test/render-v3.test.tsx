// Fork（almanac ALMNC-94.1）：元件測試基礎設施示範——renderV3() 提供 V3 模式、zh-TW 語系與主題，且不 mock Radix Popover／DropdownMenu。
import { describe, expect, it, vi } from 'vitest'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useUiV3 } from '@/lib/fork-ui'
import { renderV3, screen } from './render-v3'

function Probe({ onMenuSelect }: { onMenuSelect: () => void }) {
  const t = useTranslations('sidebarV3')
  const isV3 = useUiV3()

  return (
    <div>
      <span>{isV3 ? 'v3-on' : 'v3-off'}</span>
      <span>{t('nav.today')}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button">打開氣泡</Button>
        </PopoverTrigger>
        <PopoverContent>
          <p>氣泡內容</p>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button">打開選單</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onMenuSelect}>執行項目</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

describe('renderV3 test infrastructure (ALMNC-94.1)', () => {
  it('預設提供 V3 模式、zh-TW 語系與主題，並支援真實 Radix Popover 與 DropdownMenu 互動', async () => {
    const onMenuSelect = vi.fn()
    const { user } = renderV3(<Probe onMenuSelect={onMenuSelect} />, { theme: 'dark' })

    expect(document.documentElement.dataset.ui).toBe('v3')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByText('v3-on')).toBeInTheDocument()
    expect(screen.getByText('今天')).toBeInTheDocument()

    expect(screen.queryByText('氣泡內容')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '打開氣泡' }))
    expect(await screen.findByText('氣泡內容')).toBeVisible()

    expect(screen.queryByRole('menuitem', { name: '執行項目' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '打開選單' }))
    const item = await screen.findByRole('menuitem', { name: '執行項目' })
    await user.click(item)
    expect(onMenuSelect).toHaveBeenCalledOnce()
  })
})
