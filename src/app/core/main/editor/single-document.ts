// Fork（almanac ALMNC-97.1，取代 ALMNC-54.17 的單篇模式）：V3 可以同時開多篇，用文件切換器切換；
// 但仍然只有一個編輯群組，不分割。這裡把分割的窗格收成一個群組，所有分頁都留下來。
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
 * 把版面收成單一群組，保留所有分頁。
 * keepTabId：收完後的使用中分頁（通常是 store 的 activeTabId）；不在版面裡時沿用使用中群組的使用中分頁。
 * 分頁順序：留下的群組在前，其他群組的分頁依群組順序接在後面（重複的去掉）。
 * 已經是單一群組、沒有最大化時原樣回傳（同一個物件），不去改使用中分頁——切換分頁時版面會先更新、
 * store 的 activeTabId 稍後才跟上，這時不能拿舊的 activeTabId 把版面改回去。
 */
export function collapseToSingleGroup(
  layout: EditorWorkspaceLayout,
  keepTabId?: string,
): EditorWorkspaceLayout {
  const groupIds = getEditorGroupIds(layout.root).filter(id => layout.groups[id])
  if (groupIds.length === 0) return layout
  if (groupIds.length === 1 && !layout.maximizedGroupId) return layout
  const keepGroupId = (keepTabId && groupIds.find(id => layout.groups[id].tabIds.includes(keepTabId)))
    || (layout.groups[layout.activeGroupId] && groupIds.includes(layout.activeGroupId) ? layout.activeGroupId : groupIds[0])
  const keepGroup = layout.groups[keepGroupId]
  const tabIds = [...new Set([keepGroupId, ...groupIds.filter(id => id !== keepGroupId)].flatMap(id => layout.groups[id].tabIds))]
  const activeTabId = keepTabId && tabIds.includes(keepTabId)
    ? keepTabId
    : tabIds.includes(keepGroup.activeTabId) ? keepGroup.activeTabId : tabIds.at(-1) ?? ''

  const node = findGroupNode(layout.root, keepGroupId)
  return {
    ...layout,
    root: { type: 'group', id: node?.id ?? `editor-node-${keepGroupId}`, groupId: keepGroupId },
    groups: { [keepGroupId]: { ...keepGroup, tabIds, activeTabId } },
    activeGroupId: keepGroupId,
    maximizedGroupId: undefined,
  }
}
