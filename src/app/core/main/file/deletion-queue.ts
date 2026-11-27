/**
 * Runs file-deletion requests one at a time, in the order they were made.
 *
 * A request for a selection that is already queued or running is dropped, so a
 * repeated shortcut or menu click does not open a second confirmation for the
 * same entries. A request for a different selection waits for the earlier ones
 * instead of being ignored.
 */
export interface DeletionQueue {
  /** Resolves `false` when an identical request is already queued or running. */
  enqueue: (paths: string[], task: () => Promise<void>) => Promise<boolean>
}

export function createDeletionQueue(): DeletionQueue {
  let tail: Promise<void> = Promise.resolve()
  const pendingKeys = new Set<string>()

  return {
    enqueue(paths, task) {
      const key = [...new Set(paths)].sort().join('\n')
      if (pendingKeys.has(key)) return Promise.resolve(false)
      pendingKeys.add(key)

      const run = tail.then(task).finally(() => {
        pendingKeys.delete(key)
      })
      // One failed deletion must not block the requests queued after it.
      tail = run.catch(() => undefined)
      return run.then(() => true)
    },
  }
}
