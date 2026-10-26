import { beforeEach, describe, expect, it, vi } from 'vitest'

const commandsMock = vi.hoisted(() => ({
  listGitVersionLog: vi.fn(),
  showGitVersionFile: vi.fn(),
}))
vi.mock('./commands', () => commandsMock)

const { getLatestPromptVersionBaseline } = await import('./prompt-version-baseline')

describe('getLatestPromptVersionBaseline', () => {
  beforeEach(() => {
    commandsMock.listGitVersionLog.mockReset()
    commandsMock.showGitVersionFile.mockReset()
  })

  it('returns hasPromptVersion:false when the note never had a prompt-version commit', async () => {
    commandsMock.listGitVersionLog.mockResolvedValue([
      { id: 'a1', shortId: 'a1', summary: '自動快照', kind: 'auto-snapshot', authorName: 'NoteGen', timeSeconds: 1 },
    ])
    const baseline = await getLatestPromptVersionBaseline('/vault', 'Prompts/a.md')
    expect(baseline).toEqual({ hasPromptVersion: false, content: null })
    expect(commandsMock.showGitVersionFile).not.toHaveBeenCalled()
  })

  it('reads the content at the newest prompt-version commit, skipping auto-snapshots', async () => {
    commandsMock.listGitVersionLog.mockResolvedValue([
      { id: 'a3', shortId: 'a3', summary: '自動快照', kind: 'auto-snapshot', authorName: 'NoteGen', timeSeconds: 3 },
      { id: 'a2', shortId: 'a2', summary: '第二版', kind: 'prompt-version', authorName: 'NoteGen', timeSeconds: 2 },
      { id: 'a1', shortId: 'a1', summary: '第一版', kind: 'prompt-version', authorName: 'NoteGen', timeSeconds: 1 },
    ])
    commandsMock.showGitVersionFile.mockResolvedValue('第二版的內容')

    const baseline = await getLatestPromptVersionBaseline('/vault', 'Prompts/a.md')

    expect(commandsMock.listGitVersionLog).toHaveBeenCalledWith('/vault', { path: 'Prompts/a.md' })
    expect(commandsMock.showGitVersionFile).toHaveBeenCalledWith('/vault', 'a2', 'Prompts/a.md')
    expect(baseline).toEqual({ hasPromptVersion: true, content: '第二版的內容' })
  })

  it('returns hasPromptVersion:false when the note has no history at all', async () => {
    commandsMock.listGitVersionLog.mockResolvedValue([])
    const baseline = await getLatestPromptVersionBaseline('/vault', 'Prompts/a.md')
    expect(baseline).toEqual({ hasPromptVersion: false, content: null })
  })
})
