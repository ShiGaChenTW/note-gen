import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import useVaultIndexStore from '@/stores/vault-index'
import { createProjectArchiveDeps } from './archive-io'

function projectNote(path: string, title: string): IndexedNote {
  return { path, frontmatter: { type: 'project', title }, headings: [] } as unknown as IndexedNote
}

describe('createProjectArchiveDeps().findProjectNotes', () => {
  afterEach(() => {
    vi.useRealTimers()
    useVaultIndexStore.getState().reset('')
  })

  it('索引還在掃描時結束專案：等掃完再找，不會回傳空的', async () => {
    useVaultIndexStore.getState().setStatus('scanning')
    const found = createProjectArchiveDeps().findProjectNotes('電子紙')

    // 掃描完成前不能先用空索引回答
    let settled = false
    void found.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    useVaultIndexStore.getState().replaceAll(new Map([['40 專案/電子紙.md', projectNote('40 專案/電子紙.md', '電子紙')]]))
    useVaultIndexStore.getState().setStatus('ready')
    await expect(found).resolves.toEqual(['40 專案/電子紙.md'])
  })

  it('索引已就緒時直接查', async () => {
    useVaultIndexStore.getState().replaceAll(new Map([['讀書會.md', projectNote('讀書會.md', '讀書會')]]))
    useVaultIndexStore.getState().setStatus('ready')
    await expect(createProjectArchiveDeps().findProjectNotes('讀書會')).resolves.toEqual(['讀書會.md'])
  })

  it('索引一直沒掃完：逾時後用手上的索引，不會卡住', async () => {
    vi.useFakeTimers()
    useVaultIndexStore.getState().setStatus('scanning')
    const found = createProjectArchiveDeps().findProjectNotes('電子紙')
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(found).resolves.toEqual([])
  })
})
