'use client'

// Fork（#31）：載入首頁設定、註冊 ⌘⇧H，並掛上首頁。由 fork-services.tsx 掛一次。
import { useEffect } from 'react'
import useHomeStore from '@/stores/home'
import { HOME_CARDS } from './home-cards'
import { HomeScreen } from './home-screen'

export function HomeService() {
  const init = useHomeStore(state => state.init)

  useEffect(() => {
    void init(HOME_CARDS)
  }, [init])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return
      if (event.code !== 'KeyH') return
      event.preventDefault()
      useHomeStore.getState().toggle()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return <HomeScreen />
}
