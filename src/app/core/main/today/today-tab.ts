// Fork (D2): the Today page lives in a virtual tab. It reuses the upstream "blank"
// tab kind with a fixed path, so persistence, activation and restore validation
// work without touching more upstream code than a render branch and this hook.
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import useArticleStore from '@/stores/article'
import type { EditorWorkspaceLayout } from '../editor/editor-group-layout'
import type { TabInfo } from '../editor/tab-bar'

export const TODAY_TAB_ID = 'fork-today'
export const TODAY_TAB_PATH = 'blank://fork-today'

export function isTodayTab(tab: { path: string }): boolean {
  return tab.path === TODAY_TAB_PATH
}

const useTodayTabRequests = create<{ seq: number, request: () => void }>(set => ({
  seq: 0,
  request: () => set(state => ({ seq: state.seq + 1 })),
}))

/** 從任何地方（狀態列、指令）要求開啟今日分頁。 */
export function openTodayTab() {
  useTodayTabRequests.getState().request()
}

/**
 * 給 EditorLayout 使用：收到開啟要求時，已開著就切過去，沒開就在目前的群組新增。
 */
export function useTodayTabOpener(input: {
  layoutReady: boolean
  layoutRef: React.RefObject<EditorWorkspaceLayout>
  setLayout: (update: (current: EditorWorkspaceLayout) => EditorWorkspaceLayout) => void
  activateTab: (groupId: string, tab?: TabInfo | null) => Promise<unknown>
  canDeactivateActiveEditor: () => boolean
  title: string
}) {
  const seq = useTodayTabRequests(state => state.seq)
  const handled = useRef(seq)
  const latest = useRef(input)
  latest.current = input

  useEffect(() => {
    if (seq === handled.current || !input.layoutReady) return
    handled.current = seq
    const { layoutRef, setLayout, activateTab, canDeactivateActiveEditor, title } = latest.current
    const layout = layoutRef.current
    if (!layout) return

    const existingGroup = Object.values(layout.groups).find(group => group.tabIds.includes(TODAY_TAB_ID))
    const existingTab = useArticleStore.getState().openTabs.find(tab => tab.id === TODAY_TAB_ID) as TabInfo | undefined
    if (existingGroup && existingTab) {
      if (!canDeactivateActiveEditor()) return
      setLayout(current => ({
        ...current,
        activeGroupId: existingGroup.id,
        groups: { ...current.groups, [existingGroup.id]: { ...existingGroup, activeTabId: TODAY_TAB_ID } },
      }))
      void activateTab(existingGroup.id, existingTab)
      return
    }

    if (!canDeactivateActiveEditor()) return
    const tab: TabInfo = { id: TODAY_TAB_ID, path: TODAY_TAB_PATH, name: title, isFolder: false, kind: 'blank' }
    const groupId = layout.activeGroupId
    void useArticleStore.getState().addTab(tab).then(() => {
      if (!useArticleStore.getState().openTabs.some(item => item.id === TODAY_TAB_ID)) return
      setLayout(current => {
        const group = current.groups[groupId]
        if (!group) return current
        return {
          ...current,
          activeGroupId: groupId,
          groups: {
            ...current.groups,
            [groupId]: {
              ...group,
              tabIds: group.tabIds.includes(TODAY_TAB_ID) ? group.tabIds : [TODAY_TAB_ID, ...group.tabIds],
              activeTabId: TODAY_TAB_ID,
            },
          },
        }
      })
      void activateTab(groupId, tab)
    })
  }, [seq, input.layoutReady])
}
