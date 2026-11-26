// almanac ALMNC-22 / ALMNC-94.1：新介面不顯示「回到工作區」，舊介面照舊（改寫為 Testing Library + renderV3 示範）。
import { describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../messages/zh-TW.json'
import { renderV3, screen } from '@/test/render-v3'
import { PageHeader } from './page-ui'

describe('PageHeader back button', () => {
  it('is hidden in the new interface', () => {
    renderV3(<PageHeader title="今天" onBack={vi.fn()} backShortcut="⌘⇧H" />)
    expect(screen.queryByRole('button', { name: new RegExp(zhTW.home.backToWorkspace) })).not.toBeInTheDocument()
  })

  it('stays in classic and still goes back', async () => {
    const onBack = vi.fn()
    const { user } = renderV3(<PageHeader title="今天" onBack={onBack} backShortcut="⌘⇧H" />, { mode: 'classic' })
    const button = screen.getByRole('button', { name: new RegExp(zhTW.home.backToWorkspace) })
    await user.click(button)
    expect(onBack).toHaveBeenCalledOnce()
  })
})

// ALMNC-79.2：V3 頁首單行 56px，標題、副標、動作同一列；頁籤另起一列
describe('PageHeader V3 layout', () => {
  it('keeps title, subtitle and actions on one 56px row, tabs below', () => {
    const { container } = renderV3(
      <PageHeader
        title="今天"
        subtitle="11 月 24 日"
        onBack={vi.fn()}
        actions={<button type="button">動作</button>}
        tabs={<div data-tabs="">頁籤</div>}
      />,
    )
    const header = container.querySelector('[data-page-header]')!
    const row = header.firstElementChild as HTMLElement
    expect(row.className).toContain('h-14')
    expect(screen.getByRole('heading', { level: 1, name: '今天' })).toBeInTheDocument()
    expect(screen.getByText('11 月 24 日')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '動作' })).toBeInTheDocument()
    expect(row.querySelector('[data-tabs]')).toBeNull()
    expect(header.querySelector('[data-tabs]')).toBeTruthy()
  })
})
