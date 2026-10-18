'use client'

// Fork (D3): ⌘⌥[ / ⌘⌥] (Ctrl+Alt on Windows/Linux) open the previous / next daily note.
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { platform } from '@tauri-apps/plugin-os'
import { stepDailyNoteWithFeedback } from './daily-calendar'

export function DailyNavShortcuts() {
  const t = useTranslations('today.calendarNav')

  useEffect(() => {
    let isMac = false
    try { isMac = platform() === 'macos' } catch { isMac = false }
    const messages = { none: t('noMore'), failed: t('openFailed') }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.shiftKey) return
      const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (!mod || !event.altKey) return
      const direction = event.code === 'BracketLeft' ? -1 : event.code === 'BracketRight' ? 1 : 0
      if (!direction) return
      event.preventDefault()
      event.stopPropagation()
      stepDailyNoteWithFeedback(direction, messages)
    }
    // capture：搶在編輯器處理按鍵之前
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [t])

  return null
}
