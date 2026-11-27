import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceMock = vi.hoisted(() => ({
  getWorkspacePath: vi.fn(),
  getDefaultArticleAbsolutePath: vi.fn(),
  getFilePathOptions: vi.fn(),
}))

vi.mock('@/lib/workspace', () => workspaceMock)

const { resolveTrashWorkspaceScope } = await import('./runtime')

describe('resolveTrashWorkspaceScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceMock.getDefaultArticleAbsolutePath.mockResolvedValue('/mock/app-data/article')
  })

  it('normalizes default-workspace roots to canonical article scope', async () => {
    workspaceMock.getWorkspacePath.mockResolvedValue({ path: 'article', isCustom: false })

    await expect(resolveTrashWorkspaceScope()).resolves.toBe('article')
    await expect(resolveTrashWorkspaceScope('/mock/app-data/article')).resolves.toBe('article')
    await expect(resolveTrashWorkspaceScope('/mock/app-data/article/')).resolves.toBe('article')
    await expect(resolveTrashWorkspaceScope('article')).resolves.toBe('article')
    await expect(resolveTrashWorkspaceScope('/other/vault/')).resolves.toBe('/other/vault')
  })

  it('keeps custom workspace scope and trims trailing slashes', async () => {
    workspaceMock.getWorkspacePath.mockResolvedValue({ path: '/Users/scott/Vault', isCustom: true })

    await expect(resolveTrashWorkspaceScope()).resolves.toBe('/Users/scott/Vault')
    await expect(resolveTrashWorkspaceScope('/Users/scott/Vault/')).resolves.toBe('/Users/scott/Vault')
    await expect(resolveTrashWorkspaceScope('/Users/scott/Other/')).resolves.toBe('/Users/scott/Other')
  })
})
