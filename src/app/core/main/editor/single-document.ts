// Fork（almanac ALMNC-54.17）：V3 一次只開一篇。V3 不顯示分頁列，也不分割；
// 編輯器版面只留「使用中的那個群組裡、使用中的那一頁」，其餘分頁從版面拿掉，交給呼叫端從 openTabs 移除。
// 開新檔時沿用原本的流程（加一頁），再由這裡把舊的那頁收掉，等於「取代目前這篇」。
import {
  getEditorGroupIds,
  type EditorGroupNode,
  type EditorLayoutNode,
  type EditorWorkspaceLayout,
} from './editor-group-layout'

function findGroupNode(node: EditorLayoutNode, groupId: string): EditorGroupNode | null {
  if (node.type === 'group') return node.groupId === groupId ? node : null
  for (const child of node.children) {
    const found = findGroupNode(child, groupId)
    if (found) return found
  }
  return null
}

/**
 * 把版面收成單一群組、單一分頁。
 * keepTabId：要留下的分頁（通常是 store 的 activeTabId）；不在版面裡時改留使用中群組的使用中分頁。
 * 已經是單一群組且最多一頁時原樣回傳（同一個物件），removedTabIds 為空。
 */
export function collapseToSingleDocument(
  layout: EditorWorkspaceLayout,
  keepTabId?: string,
): { layout: EditorWorkspaceLayout, removedTabIds: string[] } {
  const groupIds = getEditorGroupIds(layout.root).filter(id => layout.groups[id])
  if (groupIds.length === 0) return { layout, removedTabIds: [] }
  const keepGroupId = (keepTabId && groupIds.find(id => layout.groups[id].tabIds.includes(keepTabId)))
    || (layout.groups[layout.activeGroupId] && groupIds.includes(layout.activeGroupId) ? layout.activeGroupId : groupIds[0])
  const keepGroup = layout.groups[keepGroupId]
  const keep = keepTabId && keepGroup.tabIds.includes(keepTabId)
    ? keepTabId
    : keepGroup.tabIds.includes(keepGroup.activeTabId) ? keepGroup.activeTabId : keepGroup.tabIds.at(-1) ?? ''

  const allTabIds = groupIds.flatMap(id => layout.groups[id].tabIds)
  const removedTabIds = [...new Set(allTabIds.filter(id => id !== keep))]
  const alreadySingle = groupIds.length === 1
    && keepGroup.tabIds.length <= 1
    && keepGroup.activeTabId === keep
    && !layout.maximizedGroupId
  if (alreadySingle) return { layout, removedTabIds: [] }

  const node = findGroupNode(layout.root, keepGroupId)
  return {
    layout: {
      ...layout,
      root: { type: 'group', id: node?.id ?? `editor-node-${keepGroupId}`, groupId: keepGroupId },
      groups: { [keepGroupId]: { ...keepGroup, tabIds: keep ? [keep] : [], activeTabId: keep } },
      activeGroupId: keepGroupId,
      maximizedGroupId: undefined,
    },
    removedTabIds,
  }
}
