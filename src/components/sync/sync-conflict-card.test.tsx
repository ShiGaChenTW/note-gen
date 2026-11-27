// Fork（almanac ALMNC-85.3，第 8 節 3A）：同步確認卡——Scott 的偏好、soul.md、rules.md 兩台改到同一段時，讓 Scott 挑。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderV3, screen } from '@/test/render-v3'
import type { SyncConflict } from '@/lib/almanac-sync/tables/conflicts'

const actions = vi.hoisted(() => ({
  list: vi.fn(),
  resolve: vi.fn(),
}))

vi.mock('@/lib/almanac-sync/conflict-actions', () => ({
  listSyncConflictsForUi: actions.list,
  resolveSyncConflictForUi: actions.resolve,
}))

import { SyncConflictCard, SyncConflictCards } from './sync-conflict-card'

function conflict(extra: Partial<SyncConflict> = {}): SyncConflict {
  return {
    tableName: 'crew',
    syncKey: 'preferences',
    field: 'content',
    subject: 'preferences',
    agentName: null,
    agentId: null,
    base: '# 偏好\n回覆用繁體中文\n先講結論',
    local: '# 偏好\n回覆用繁體中文，條列為主\n先講結論',
    remote: '# 偏好\n回覆用繁體中文，語氣輕鬆\n先講結論',
    keptLocal: '# 偏好\n回覆用繁體中文，條列為主\n先講結論',
    takeRemote: '# 偏好\n回覆用繁體中文，語氣輕鬆\n先講結論',
    hunks: [{ base: ['回覆用繁體中文'], local: ['回覆用繁體中文，條列為主'], remote: ['回覆用繁體中文，語氣輕鬆'] }],
    status: 'open',
    createdAt: 1,
    resolvedAt: null,
    ...extra,
  }
}

describe('SyncConflictCard', () => {
  it('標出是哪份文字，兩台的版本並排都看得到', () => {
    renderV3(<SyncConflictCard conflict={conflict()} onChoose={vi.fn()} />)
    const card = screen.getByRole('region', { name: '同步確認：Scott 的偏好' })
    expect(card).toHaveTextContent('兩台裝置都改了同一段')
    expect(screen.getByRole('group', { name: '這台的版本' })).toHaveTextContent('回覆用繁體中文，條列為主')
    expect(screen.getByRole('group', { name: '另一台的版本' })).toHaveTextContent('回覆用繁體中文，語氣輕鬆')
  })

  it('soul.md、rules.md 標出哪位夥伴', () => {
    renderV3(<SyncConflictCard conflict={conflict({ subject: 'soul', agentName: 'Iris', agentId: 'exp-1', syncKey: 'memory:exp-1:soul' })} onChoose={vi.fn()} />)
    expect(screen.getByRole('region', { name: '同步確認：Iris 的 soul.md' })).toBeInTheDocument()
  })

  it('用這台的／用另一台的：回呼帶對應的選擇', async () => {
    const onChoose = vi.fn()
    const { user } = renderV3(<SyncConflictCard conflict={conflict()} onChoose={onChoose} />)
    await user.click(screen.getByRole('button', { name: '用這台的' }))
    expect(onChoose).toHaveBeenLastCalledWith({ kind: 'local' })
    await user.click(screen.getByRole('button', { name: '用另一台的' }))
    expect(onChoose).toHaveBeenLastCalledWith({ kind: 'remote' })
  })

  it('自己合併：編輯框先放目前保留的版本，存檔帶 Scott 改好的全文；取消就回到三個選項', async () => {
    const onChoose = vi.fn()
    const { user } = renderV3(<SyncConflictCard conflict={conflict()} onChoose={onChoose} />)
    await user.click(screen.getByRole('button', { name: '自己合併' }))
    const editor = screen.getByRole('textbox', { name: '合併後的內容' })
    expect(editor).toHaveValue('# 偏好\n回覆用繁體中文，條列為主\n先講結論')
    await user.clear(editor)
    await user.type(editor, '回覆用繁體中文，條列、語氣輕鬆')
    await user.click(screen.getByRole('button', { name: '存成這個版本' }))
    expect(onChoose).toHaveBeenCalledWith({ kind: 'merged', text: '回覆用繁體中文，條列、語氣輕鬆' })

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('textbox', { name: '合併後的內容' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '用這台的' })).toBeInTheDocument()
  })

  it('處理中：按鈕停用', () => {
    renderV3(<SyncConflictCard conflict={conflict()} busy onChoose={vi.fn()} />)
    expect(screen.getByRole('button', { name: '用這台的' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '用另一台的' })).toBeDisabled()
  })
})

describe('SyncConflictCards（工作台）', () => {
  beforeEach(() => {
    actions.list.mockReset()
    actions.resolve.mockReset()
  })

  it('沒有確認卡就什麼都不顯示', async () => {
    actions.list.mockResolvedValue([])
    renderV3(<SyncConflictCards />)
    await vi.waitFor(() => expect(actions.list).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: /同步確認/ })).not.toBeInTheDocument()
  })

  it('挑完就處理那張卡、重新載入，卡片消失', async () => {
    const card = conflict()
    actions.list.mockResolvedValueOnce([card]).mockResolvedValue([])
    actions.resolve.mockResolvedValue(true)
    const { user } = renderV3(<SyncConflictCards />)
    await user.click(await screen.findByRole('button', { name: '用另一台的' }))
    expect(actions.resolve).toHaveBeenCalledWith({ tableName: 'crew', syncKey: 'preferences', field: 'content' }, { kind: 'remote' })
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: /同步確認/ })).not.toBeInTheDocument())
  })
})
