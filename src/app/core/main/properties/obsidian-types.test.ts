import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ workspace: 'vault', source: '', read: vi.fn() }))
vi.mock('@/stores/vault-index', () => ({ default: { getState: () => ({ workspace: state.workspace }) } }))
vi.mock('@/lib/daily/note-io', () => ({ readNote: state.read }))
const { loadObsidianPropertyTypes } = await import('@/lib/obsidian-types')
beforeEach(() => {
  state.workspace += '-next'
  state.read.mockReset().mockImplementation(async () => state.source)
})
describe('Obsidian 型別唯讀快取', () => {
  it('只接受八種型別，並讀取隱藏資料夾的 types.json', async () => {
    const types = { a: 'text', b: 'multitext', c: 'number', d: 'checkbox', e: 'date', f: 'datetime', tags: 'tags', aliases: 'aliases' }
    state.source = JSON.stringify({ types: { ...types, bad: 'object', nested: {}, null: null } })
    expect(await loadObsidianPropertyTypes()).toEqual(types)
    expect(state.read).toHaveBeenCalledWith('.obsidian/types.json')
  })
  it('同工作區共用進行中的讀取，切換後重讀', async () => {
    state.source = '{"types":{"x":"number"}}'
    const first = loadObsidianPropertyTypes()
    expect(loadObsidianPropertyTypes()).toBe(first)
    expect(await first).toEqual({ x: 'number' })
    state.workspace = 'other'
    state.source = '{"types":{"x":"text"}}'
    expect(await loadObsidianPropertyTypes()).toEqual({ x: 'text' })
    expect(state.read).toHaveBeenCalledTimes(2)
  })
  it.each(['', '{', 'null', '[]', '{}', '{"types":[]}', '{"types":null}'])('缺少或壞掉回空表 %s', async source => {
    state.source = source
    expect(await loadObsidianPropertyTypes()).toEqual({})
  })
  it('讀檔失敗回空表', async () => {
    state.read.mockRejectedValue(new Error('missing'))
    expect(await loadObsidianPropertyTypes()).toEqual({})
  })
})
