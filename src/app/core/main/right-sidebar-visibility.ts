import { createContext, useContext } from 'react'
import { usePluginUiStore } from '@/lib/plugins/ui-registry'
import { useSidebarStore } from '@/stores/sidebar'

export const RightSidebarCollapsedContext = createContext(false)

export function useRightSidebarChatVisible() {
  const visible = useSidebarStore(state => state.rightSidebarVisible)
  const collapsed = useContext(RightSidebarCollapsedContext)
  // The right sidebar stores its default @chat tab as null.
  const isChat = usePluginUiStore(state => state.activeRightView === null)
  return visible && !collapsed && isChat
}
