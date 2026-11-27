// Fork（almanac ALMNC-89）：專案筆記開著時，編輯器工具列的「結束專案…／取消封存」——沒有同名對話分組的專案也能結束。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderV3, screen, waitFor, within } from '@/test/render-v3'
import useThreadsStore from '@/stores/threads'
import { listProjects } from '@/lib/threads/projects'
import { archivedNames } from '@/lib/projects/archive'
import type { SharedContext } from '@/lib/agent-memory/context'

const { files, context, index } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  context: { current: { projects: [], weeklyFocus: [], people: [] } as SharedContext },
  /** 筆記索引還沒跟上（找不到任何專案筆記）。 */
  index: { lagging: false },
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: vi.fn(), save: vi.fn() }) },
}))
// I/O 邊界：筆記檔與目前脈絡用記憶體裡的假資料，流程（lib/projects/archive.ts）用真的。
vi.mock('@/lib/projects/archive-io', async () => {
  const { findProjectNotes } = await import('@/lib/projects/archive')
  const { parse } = await import('yaml')
  const candidates = () => [...files.entries()].map(([path, raw]) => ({
    path, frontmatter: parse(raw.split('---')[1] ?? '') as Record<string, unknown>, headings: [],
  }))
  return {
    loadArchivedProjects: async () => ({}),
    saveArchivedProjects: async () => true,
    createProjectArchiveDeps: () => ({
      now: () => 1_700_000_000_000,
      findProjectNotes: async (name: string) => index.lagging ? [] : findProjectNotes(candidates(), name),
      rewriteNote: async (path: string, rewrite: (raw: string) => string | null) => {
        const raw = files.get(path)
        if (raw === undefined) return null
        const next = rewrite(raw)
        if (next === null || next === raw) return null
        files.set(path, next)
        return raw
      },
      getContext: async () => context.current,
      saveContext: async (next: SharedContext) => { context.current = next },
    }),
  }
})

const { ProjectArchiveButton } = await import('./project-archive-button')

const PATH = '40 專案/電子紙.md'
const PROJECT_NOTE = '---\ntype: project\ntitle: 電子紙\n---\n# 電子紙\n\n目標：做出電子紙簡報。\n'
const KNOWLEDGE_NOTE = '---\ntype: knowledge\ntitle: 墨水屏刷新\ndomains: [D-hardware]\nproject: 電子紙\nrelated: ["[[電子紙]]"]\n---\n局部刷新會殘影。\n'
const frontmatterOf = (raw: string) => raw.slice(0, raw.indexOf('---\n', 4) + 4)

beforeEach(() => {
  files.clear()
  files.set(PATH, PROJECT_NOTE)
  files.set('知識/墨水屏刷新.md', KNOWLEDGE_NOTE)
  index.lagging = false
  context.current = { projects: [{ title: '電子紙' }], weeklyFocus: [], people: [] }
  // 沒有任何對話分組：專案只有專案筆記
  useThreadsStore.setState({ ...useThreadsStore.getInitialState(), projectMap: {}, projectsLoaded: true })
})

describe('專案筆記工具列：結束專案', () => {
  it('不是專案筆記就沒有這顆按鈕', () => {
    renderV3(<ProjectArchiveButton notePath="知識/墨水屏刷新.md" raw={frontmatterOf(KNOWLEDGE_NOTE)} />)
    expect(screen.queryByRole('button', { name: '結束專案…' })).toBeNull()
    renderV3(<ProjectArchiveButton notePath="a.md" raw={null} />)
    expect(screen.queryByRole('button', { name: '結束專案…' })).toBeNull()
  })

  it('沒有同名對話分組也能結束：先確認，專案筆記封存、知識筆記不動、記進封存紀錄', async () => {
    const { user } = renderV3(<ProjectArchiveButton notePath={PATH} raw={frontmatterOf(PROJECT_NOTE)} />)
    await user.click(screen.getByRole('button', { name: '結束專案…' }))
    const dialog = await screen.findByRole('dialog', { name: '結束專案「電子紙」？' })
    expect(within(dialog).getByText(/知識筆記留在原本的領域/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: '結束並封存' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '取消封存' })).toBeTruthy())
    expect(files.get(PATH)).toContain('status: archived')
    expect(files.get(PATH)).toContain('目標：做出電子紙簡報。')
    expect(files.get('知識/墨水屏刷新.md')).toBe(KNOWLEDGE_NOTE)
    expect(context.current.projects).toEqual([])
    expect(useThreadsStore.getState().archivedProjects['電子紙']?.notes).toEqual([{ path: PATH, previousStatus: null }])
  })

  it('確認框按取消就什麼都不動', async () => {
    const { user } = renderV3(<ProjectArchiveButton notePath={PATH} raw={frontmatterOf(PROJECT_NOTE)} />)
    await user.click(screen.getByRole('button', { name: '結束專案…' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }))
    expect(files.get(PATH)).toBe(PROJECT_NOTE)
    expect(useThreadsStore.getState().archivedProjects).toEqual({})
  })

  it('取消封存：專案筆記改回原本的狀態、紀錄拿掉', async () => {
    const { user } = renderV3(<ProjectArchiveButton notePath={PATH} raw={frontmatterOf(PROJECT_NOTE)} />)
    await user.click(screen.getByRole('button', { name: '結束專案…' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '結束並封存' }))
    await user.click(await screen.findByRole('button', { name: '取消封存' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '結束專案…' })).toBeTruthy())
    expect(files.get(PATH)).toBe(PROJECT_NOTE)
    expect(useThreadsStore.getState().archivedProjects).toEqual({})
    expect(context.current.projects).toEqual([{ title: '電子紙' }])
  })

  it('筆記索引還沒跟上時，開著的這篇也會封存', async () => {
    index.lagging = true
    const { user } = renderV3(<ProjectArchiveButton notePath={PATH} raw={frontmatterOf(PROJECT_NOTE)} />)
    await user.click(screen.getByRole('button', { name: '結束專案…' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '結束並封存' }))
    await waitFor(() => expect(files.get(PATH)).toContain('status: archived'))
  })

  it('沒寫 title 時用第一個 H1 當專案名；同名對話分組一起從進行中清單移走', async () => {
    const raw = '---\ntype: project\n---\n'
    files.set('40 專案/p.md', `${raw}# 搬家\n`)
    useThreadsStore.setState({ projectMap: { s1: '搬家' } })
    const { user } = renderV3(<ProjectArchiveButton notePath="40 專案/p.md" raw={raw} heading="搬家" />)
    await user.click(screen.getByRole('button', { name: '結束專案…' }))
    await user.click(within(await screen.findByRole('dialog', { name: '結束專案「搬家」？' })).getByRole('button', { name: '結束並封存' }))
    await waitFor(() => expect(files.get('40 專案/p.md')).toContain('status: archived'))
    const { projectMap, archivedProjects } = useThreadsStore.getState()
    expect(listProjects([], projectMap, archivedNames(archivedProjects))).toEqual([])
  })

  it('手動改成封存（沒有封存紀錄）的專案筆記也能取消封存', async () => {
    const archived = '---\ntype: project\ntitle: 電子紙\nstatus: archived\n---\n# 電子紙\n'
    files.set(PATH, archived)
    const { user } = renderV3(<ProjectArchiveButton notePath={PATH} raw={frontmatterOf(archived)} />)
    await user.click(screen.getByRole('button', { name: '取消封存' }))
    await waitFor(() => expect(files.get(PATH)).toBe('---\ntype: project\ntitle: 電子紙\n---\n# 電子紙\n'))
  })
})
