import { describe, expect, it } from 'vitest'
import { createDeletionQueue } from './deletion-queue'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('createDeletionQueue', () => {
  it('連續刪除兩則不同的筆記：第二則等第一則做完再執行，不會被丟掉', async () => {
    const queue = createDeletionQueue()
    const order: string[] = []
    const first = deferred()

    const firstRun = queue.enqueue(['a.md'], async () => {
      order.push('a:start')
      await first.promise
      order.push('a:end')
    })
    const secondRun = queue.enqueue(['b.md'], async () => {
      order.push('b:start')
    })

    await flush()
    expect(order).toEqual(['a:start'])

    first.resolve()
    await expect(firstRun).resolves.toBe(true)
    await expect(secondRun).resolves.toBe(true)
    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
  })

  it('同一組選取重複觸發時只執行一次', async () => {
    const queue = createDeletionQueue()
    const first = deferred()
    let runs = 0

    const firstRun = queue.enqueue(['a.md', 'b.md'], async () => {
      runs += 1
      await first.promise
    })
    await expect(queue.enqueue(['b.md', 'a.md'], async () => { runs += 1 })).resolves.toBe(false)

    first.resolve()
    await firstRun
    expect(runs).toBe(1)
  })

  it('前一次刪除失敗不會卡住後面的刪除', async () => {
    const queue = createDeletionQueue()
    const failed = queue.enqueue(['a.md'], async () => {
      throw new Error('boom')
    })
    let secondRan = false
    const second = queue.enqueue(['b.md'], async () => {
      secondRan = true
    })

    await expect(failed).rejects.toThrow('boom')
    await expect(second).resolves.toBe(true)
    expect(secondRan).toBe(true)
  })

  it('做完之後同一則可以再次排入', async () => {
    const queue = createDeletionQueue()
    let runs = 0
    await queue.enqueue(['a.md'], async () => { runs += 1 })
    await expect(queue.enqueue(['a.md'], async () => { runs += 1 })).resolves.toBe(true)
    expect(runs).toBe(2)
  })
})
