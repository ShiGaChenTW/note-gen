// @vitest-environment jsdom
// Fork（almanac ALMNC-69.9）：比較卡——還原後與目前並排，只標出不同的行；檔案會被移除時顯示「檔案不存在」；兩個按鈕。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useTranslations: (namespace?: string) => intl.createTranslator({ locale: 'en', messages: { ops: en.ops }, namespace: (namespace ?? 'ops') as 'ops' }),
  }
})

import { UndoCompareCard } from './undo-compare-card'

it('renders restored vs current side by side for every file and wires the buttons', async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  const c = en.ops.compare
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(React.createElement(UndoCompareCard, {
      files: [
        { path: '10 知識/新筆記.md', restored: null, current: '# 新筆記\nScott 加的一段', changed: true },
        { path: '20 領域/時間管理.md', restored: 'a\nb', current: 'a\nb\nc', changed: false },
      ],
      onConfirm,
      onCancel,
    })))
    const files = [...container.querySelectorAll('[data-path]')]
    expect(files.map(file => file.getAttribute('data-path'))).toEqual(['10 知識/新筆記.md', '20 領域/時間管理.md'])
    expect(files[0].querySelector('[data-side="restored"]')!.textContent).toBe(c.missing)
    expect(files[0].querySelector('[data-side="current"]')!.textContent).toContain('Scott 加的一段')
    expect(files[0].textContent).toContain(c.changed)
    expect(files[1].textContent).not.toContain(c.changed)
    expect([...files[1].querySelectorAll('[data-side="current"] [data-changed]')].map(line => line.textContent)).toEqual(['c'])
    expect(files[1].querySelectorAll('[data-side="restored"] [data-changed]')).toHaveLength(0)
    const buttons = [...container.querySelectorAll('button')]
    await act(async () => buttons.find(button => button.textContent === c.confirm)!.click())
    await act(async () => buttons.find(button => button.textContent === c.cancel)!.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
