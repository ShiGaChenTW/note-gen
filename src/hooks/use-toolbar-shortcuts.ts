import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import emitter from '@/lib/emitter'
import { isEditableKeyboardTarget } from '@/lib/is-editable-keyboard-target'
import { resolveUnifiedRecordShortcut } from '@/lib/unified-record-input'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

export function useToolbarShortcuts() {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')

  useEffect(() => {
    try {
      const detected = platform()
      if (detected === 'macos' || detected === 'windows' || detected === 'linux') {
        setCurrentPlatform(detected)
      }
    } catch (error) {
      console.error('Error detecting platform:', error)
    }
  }, [])

  useEffect(() => {
    if (currentPlatform === 'unknown') return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableKeyboardTarget(e.target)) return
      const type = resolveUnifiedRecordShortcut(e, currentPlatform)
      if (!type) return

      e.preventDefault()
      emitter.emit('unified-record-open', { type })
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [currentPlatform])

  return { currentPlatform }
}
