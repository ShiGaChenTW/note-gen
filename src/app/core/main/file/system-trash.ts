import { deleteSelfHostedWorkspacePath } from '@/lib/self-hosted-sync/files'
import { moveToAppTrash } from '@/lib/trash/runtime'
import type { TrashActor, TrashSource } from '@/lib/trash/types'

export interface TrashMoveOptions {
  deletedBy?: string
  actorRole?: TrashActor
  source?: TrashSource
  isDirectory?: boolean
}

export async function moveEntriesToSystemTrash(
  relativePaths: string[],
  workspaceRoot?: string,
  options: TrashMoveOptions = {},
) {
  let moved = 0
  for (const relativePath of relativePaths) {
    if (!workspaceRoot && await deleteSelfHostedWorkspacePath(
      relativePath,
      options.isDirectory ? 'folder' : undefined,
      options,
    )) {
      moved += 1
      continue
    }
    const item = await moveToAppTrash(relativePath, {
      workspaceRoot,
      isDirectory: options.isDirectory,
      deletedBy: options.deletedBy ?? 'scott',
      actorRole: options.actorRole ?? 'scott',
      source: options.source ?? 'file-tree',
    })
    if (item) moved += 1
  }
  return moved
}

export async function moveEntryToSystemTrash(
  relativePath: string,
  workspaceRoot?: string,
  options: TrashMoveOptions = {},
) {
  return (await moveEntriesToSystemTrash([relativePath], workspaceRoot, options)) > 0
}
