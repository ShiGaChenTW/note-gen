import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setActiveFilePath: vi.fn(async () => undefined),
  noteExists: vi.fn(async () => false),
  writeNote: vi.fn(async () => undefined),
  readNote: vi.fn(async () => ''),
  revealInFileTree: vi.fn(async () => undefined),
}))

vi.mock('@/stores/article', () => ({
  default: { getState: () => ({ setActiveFilePath: mocks.setActiveFilePath, activeFilePath: '' }) },
}))
vi.mock('@/stores/vault-index', () => ({
  default: { getState: () => ({ notes: new Map() }) },
}))
vi.mock('@/stores/daily-settings', () => ({
  default: {
    getState: () => ({
      initSettings: async () => undefined,
      dailyFolder: '',
      dailyPattern: 'YYYYMMDD',
      defaultTemplate: '',
      weekdayTemplates: {},
    }),
  },
}))
vi.mock('./daily-note-content', () => ({
  buildDailyNoteContent: async () => '# today\n',
}))
vi.mock('./note-io', () => ({
  noteExists: mocks.noteExists,
  writeNote: mocks.writeNote,
  readNote: mocks.readNote,
  revealInFileTree: mocks.revealInFileTree,
}))

import { openDailyNote } from './open-daily-note'

const NOW = new Date(2026, 10, 27, 9, 0, 0)

describe('openDailyNote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.noteExists.mockResolvedValue(false)
  })

  it('預設會建立並打開今天的日記', async () => {
    const result = await openDailyNote(NOW)

    expect(result.created).toBe(true)
    expect(mocks.writeNote).toHaveBeenCalledWith(result.path, '# today\n')
    expect(mocks.setActiveFilePath).toHaveBeenCalledWith(result.path)
  })

  it('準備日記期間使用者已打開別的筆記：只建立日記，不切換分頁', async () => {
    const result = await openDailyNote(NOW, { shouldActivate: () => false })

    expect(result.created).toBe(true)
    expect(mocks.writeNote).toHaveBeenCalledWith(result.path, '# today\n')
    expect(mocks.setActiveFilePath).not.toHaveBeenCalled()
  })

  it('日記已存在、在展開檔案樹時使用者切到別的筆記：不切換分頁', async () => {
    mocks.noteExists.mockResolvedValue(true)
    let wanted = true
    mocks.revealInFileTree.mockImplementationOnce(async () => {
      wanted = false
    })

    const result = await openDailyNote(NOW, { shouldActivate: () => wanted })

    expect(result.created).toBe(false)
    expect(mocks.revealInFileTree).toHaveBeenCalledWith(result.path)
    expect(mocks.setActiveFilePath).not.toHaveBeenCalled()
  })
})
