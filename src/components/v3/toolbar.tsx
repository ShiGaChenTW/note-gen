'use client'

// Fork（almanac ALMNC-56.2 A11、V07）：V3 編輯區兩條工具列（右上筆記工具列、底部格式列）共用的圖示按鈕、分隔線與鍵盤操作。
// - ToolbarIconButton：28 px 圓角方形，滑過 bg-hover、按下 bg-active；focus 用 1 px ink 外框（roving 時 tabindex=-1 也看得到，
//   V3 全域 focus 規則會把 tabindex=-1 的外框拿掉）。
// - 泡泡選單的顏色鈕在 classic 也會用到，所以 V3 的圓角（--r-kbd，ALMNC-56.6 V14）用 v3: 覆寫。
// - useRovingToolbar：整列只留一個 Tab 停靠點，左右鍵在列內移動、Home／End 跳到頭尾，跳過停用的按鈕。
import { useCallback, useLayoutEffect, useRef, type ComponentProps, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import { cn } from '@/lib/utils'

export const TOOLBAR_ICON_BUTTON = 'relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-md v3:rounded-(--r-kbd) text-muted-ink outline-none transition-colors duration-100 enabled:hover:bg-hover enabled:hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0'

export const TOOLBAR_ICON_BUTTON_ACTIVE = 'bg-active text-ink'

export function ToolbarIconButton({ pressed, active, className, type = 'button', ...props }: ComponentProps<'button'> & {
  /** 切換類按鈕：設定 aria-pressed，按下時亮起 */
  pressed?: boolean
  /** 只亮起、不設 aria-pressed（例如顏色選單：目前文字有顏色） */
  active?: boolean
}) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(TOOLBAR_ICON_BUTTON, (pressed || active) && TOOLBAR_ICON_BUTTON_ACTIVE, className)}
      {...props}
    />
  )
}

export function ToolbarDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn('mx-1 h-4 w-px shrink-0 bg-line', className)} />
}

/**
 * 依按鍵算出要移到第幾個按鈕；不是移動鍵時回傳 null。到頭尾會繞回另一端。
 * index 為 -1（焦點不在任何按鈕上）時，往前從第一個開始、往後從最後一個開始。
 */
export function rovingTargetIndex(key: string, index: number, count: number, rtl = false): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  const forward = (key === 'ArrowRight') !== rtl
  if (index < 0) return forward ? 0 : count - 1
  return (index + (forward ? 1 : -1) + count) % count
}

const enabledButtons = (root: HTMLElement | null) => (
  root ? [...root.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.disabled) : []
)

/**
 * 工具列的 roving tabindex。把回傳的 onKeyDown、onFocus 掛在 role="toolbar" 的容器上；ref 指向同一個容器。
 * 每次重繪後重新整理 tabindex：停靠點是上次聚焦的按鈕，它不見或停用時改成第一個可用的按鈕。
 * 浮層內容（Popover、DropdownMenu）都走 Portal，不在容器裡，不會被算進來。
 */
export function useRovingToolbar<T extends HTMLElement>(ref: RefObject<T | null>) {
  const stop = useRef<HTMLButtonElement | null>(null)

  const sync = useCallback(() => {
    const root = ref.current
    if (!root) return
    const enabled = enabledButtons(root)
    const next = stop.current && enabled.includes(stop.current) ? stop.current : enabled[0] ?? null
    stop.current = next
    for (const button of root.querySelectorAll<HTMLButtonElement>('button')) button.tabIndex = button === next ? 0 : -1
  }, [ref])

  // 不給依賴：每次重繪後都整理一次（按鈕會因窄版收合、換篇、停用狀態而增減），至多二十來顆按鈕。
  useLayoutEffect(() => { sync() })

  const onFocus = useCallback((event: FocusEvent<T>) => {
    const target = event.target as HTMLElement
    if (!(target instanceof HTMLButtonElement) || target.disabled || !ref.current?.contains(target)) return
    if (stop.current === target) return
    stop.current = target
    sync()
  }, [ref, sync])

  const onKeyDown = useCallback((event: KeyboardEvent<T>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return
    const enabled = enabledButtons(ref.current)
    const index = enabled.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const next = rovingTargetIndex(event.key, index, enabled.length, rtl)
    if (next === null) return
    event.preventDefault()
    stop.current = enabled[next]
    sync()
    enabled[next].focus()
  }, [ref, sync])

  return { onFocus, onKeyDown }
}
