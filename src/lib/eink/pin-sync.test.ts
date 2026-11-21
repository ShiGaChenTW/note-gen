// almanac ALMNC-45：筆記改名或移動後釘選跟著走；刪除後從清單移除（App 內事件與外部檔案變更）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import emitter from '@/lib/emitter'
import { configureEinkStorage, type EinkStorage } from './storage'
import useEinkStore, { resetEinkStoreForTest } from '@/stores/eink'
import { initEinkPinSync } from './pin-sync'

function memoryStorage(): EinkStorage {
  const data = new Map<string, unknown>()
  return { get: async key => data.get(key), set: async (key, value) => { data.set(key, value) }, save: async () => {} }
}

const paths = () => useEinkStore.getState().pins.map(pin => pin.path)
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

let stop: () => void
const exists = vi.fn(async () => false)

beforeEach(async () => {
  configureEinkStorage(memoryStorage())
  resetEinkStoreForTest()
  exists.mockReset().mockResolvedValue(false)
  stop = initEinkPinSync(exists)
  const store = useEinkStore.getState()
  await store.togglePin('筆記/a.md')
  await store.togglePin('筆記/子/b.md')
  await store.togglePin('c.md')
})
afterEach(() => {
  stop()
  configureEinkStorage(null)
})

describe('initEinkPinSync', () => {
  it('檔案樹改名（editor-navigation-path-moved）後路徑跟著換', async () => {
    emitter.emit('editor-navigation-path-moved', { oldPath: 'c.md', newPath: 'c2.md' })
    await settle()
    expect(paths()).toEqual(['筆記/a.md', '筆記/子/b.md', 'c2.md'])
  })

  it('AI 工具或外掛搬檔（editor-file-path-changed）也跟著換；資料夾搬移連同底下', async () => {
    emitter.emit('editor-file-path-changed', { oldPath: '筆記', newPath: '封存/筆記' })
    await settle()
    expect(paths()).toEqual(['封存/筆記/a.md', '封存/筆記/子/b.md', 'c.md'])
  })

  it('App 內刪除檔案或資料夾後從清單移除', async () => {
    emitter.emit('editor-navigation-path-deleted', { path: 'c.md', isFolder: false })
    emitter.emit('editor-navigation-path-deleted', { path: '筆記/子', isFolder: true })
    await settle()
    expect(paths()).toEqual(['筆記/a.md'])
  })

  it('外部移動（檔案監看 moved）跟著換', async () => {
    emitter.emit('workspace-file-changed', { kind: 'moved', path: 'd.md', previousPath: 'c.md', workspaceRoot: '/vault' })
    await settle()
    expect(paths()).toContain('d.md')
  })

  it('外部刪除：確認檔案真的不在才移除（外部編輯器常是刪掉再寫回）', async () => {
    exists.mockResolvedValueOnce(true)
    emitter.emit('workspace-file-changed', { kind: 'deleted', path: 'c.md', workspaceRoot: '/vault' })
    await settle()
    expect(paths()).toContain('c.md')
    emitter.emit('workspace-file-changed', { kind: 'deleted', path: 'c.md', workspaceRoot: '/vault' })
    await settle()
    expect(paths()).not.toContain('c.md')
    expect(exists).toHaveBeenCalledWith('/vault', 'c.md')
  })

  it('沒釘選的檔案被刪不去查檔案；停止監聽後不再更新', async () => {
    emitter.emit('workspace-file-changed', { kind: 'deleted', path: 'other.md', workspaceRoot: '/vault' })
    await settle()
    expect(exists).not.toHaveBeenCalled()
    stop()
    emitter.emit('editor-navigation-path-moved', { oldPath: 'c.md', newPath: 'x.md' })
    await settle()
    expect(paths()).toContain('c.md')
    stop = () => {}
  })
})
