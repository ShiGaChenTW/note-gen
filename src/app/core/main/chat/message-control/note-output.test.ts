import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 1 },
  readDir: vi.fn(async () => []),
  writeTextFile: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })) },
}))

const { buildNoteOutputPath } = await import('./note-output')

describe('buildNoteOutputPath', () => {
  it('returns root-relative file path without leading slashes for root directory', () => {
    expect(buildNoteOutputPath('/', 'E2E 標籤轉化筆記.md')).toBe('E2E_標籤轉化筆記.md')
    expect(buildNoteOutputPath('', '測試 筆記.md')).toBe('測試_筆記.md')
  })

  it('normalizes subfolder slashes and title spaces', () => {
    expect(buildNoteOutputPath('/20 Journal/', '測試 筆記.md')).toBe('20 Journal/測試_筆記.md')
    expect(buildNoteOutputPath('Notes/Sub', 'simple.md')).toBe('Notes/Sub/simple.md')
  })
})
