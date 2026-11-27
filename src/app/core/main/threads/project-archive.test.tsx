// Fork（almanac ALMNC-89）：對話頁的「結束專案」與「取消封存」入口。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderV3, screen, waitFor, within } from '@/test/render-v3'
import useThreadsStore from '@/stores/threads'
import useChatStore from '@/stores/chat'
import type { SharedContext } from '@/lib/agent-memory/context'

const { files, context } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  context: { current: { projects: [], weeklyFocus: [], people: [] } as SharedContext },
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: vi.fn(), save: vi.fn() }) },
}))
vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      chats: [], conversations: [], currentConversationId: null, loading: false,
      initConversations: vi.fn(), startNewConversation: vi.fn(), switchConversation: vi.fn(),
    })),
  }
})
vi.mock('@/stores/setting', () => ({ default: () => ({ language: 'zh-TW' }) }))
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
      findProjectNotes: async (name: string) => findProjectNotes(candidates(), name),
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

const { ThreadList } = await import('./threads-screen')

const PROJECT_NOTE = '---\ntype: project\ntitle: 電子紙\n---\n# 電子紙\n\n目標：做出電子紙簡報。\n'
const KNOWLEDGE_NOTE = '---\ntype: knowledge\ntitle: 墨水屏刷新\ndomains: [D-hardware]\nproject: 電子紙\nrelated: ["[[電子紙]]"]\n---\n局部刷新會殘影。\n'

function conversation(id: number, title: string, updatedAt: number) {
  return { id, syncId: `s${id}`, title, updatedAt, messageCount: 2, isPinned: false }
}

beforeEach(() => {
  files.clear()
  files.set('40 專案/電子紙.md', PROJECT_NOTE)
  files.set('知識/墨水屏刷新.md', KNOWLEDGE_NOTE)
  context.current = { projects: [{ title: '電子紙' }, { title: '搬家' }], weeklyFocus: [], people: [] }
  useChatStore.setState({
    conversations: [conversation(1, '電子紙排版', 300), conversation(2, '搬家清單', 200)],
    currentConversationId: null,
  } as never)
  useThreadsStore.setState({
    ...useThreadsStore.getInitialState(),
    projectMap: { s1: '電子紙', s2: '搬家' },
    projectsLoaded: true,
    mode: 'project',
  })
})

const list = () => screen.getByRole('list', { name: '對話串' })

async function endProject(user: ReturnType<typeof renderV3>['user'], name: string) {
  await user.click(screen.getByRole('button', { name: `「${name}」的專案動作` }))
  await user.click(await screen.findByRole('menuitem', { name: '結束專案…' }))
  const dialog = await screen.findByRole('dialog', { name: `結束專案「${name}」？` })
  await user.click(within(dialog).getByRole('button', { name: '結束並封存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

describe('對話頁：結束專案', () => {
  it('結束專案要先確認；取消就什麼都不動', async () => {
    const { user } = renderV3(<ThreadList />)
    await user.click(screen.getByRole('button', { name: '「電子紙」的專案動作' }))
    await user.click(await screen.findByRole('menuitem', { name: '結束專案…' }))
    const dialog = await screen.findByRole('dialog', { name: '結束專案「電子紙」？' })
    expect(within(dialog).getByText(/知識筆記留在原本的領域/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(useThreadsStore.getState().archivedProjects).toEqual({})
    expect(files.get('40 專案/電子紙.md')).toBe(PROJECT_NOTE)
  })

  it('結束後專案從進行中清單移走、專案筆記封存（不刪除），知識筆記不動', async () => {
    const { user } = renderV3(<ThreadList />)
    await endProject(user, '電子紙')

    // 進行中清單不再有這個專案，也不在「移到專案」選單
    expect(within(list()).queryByRole('button', { name: /電子紙排版/ })).toBeNull()
    expect(within(list()).getByRole('button', { name: /搬家清單/ })).toBeTruthy()
    await user.click(within(list()).getByRole('button', { name: '移到專案' }))
    expect(screen.queryByRole('menuitem', { name: '電子紙' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: '搬家' })).toBeTruthy()
    await user.keyboard('{Escape}')

    // 專案筆記還在、狀態是封存；知識筆記原封不動
    expect(files.get('40 專案/電子紙.md')).toContain('status: archived')
    expect(files.get('40 專案/電子紙.md')).toContain('目標：做出電子紙簡報。')
    expect(files.get('知識/墨水屏刷新.md')).toBe(KNOWLEDGE_NOTE)
    // 目前脈絡的進行中專案也拿掉
    expect(context.current.projects).toEqual([{ title: '搬家' }])
    // 出現在「已封存的專案」
    expect(screen.getByRole('button', { name: /已封存的專案/ })).toBeTruthy()
  })

  it('封存的專案搜尋得到（對話與專案名）', async () => {
    const { user } = renderV3(<ThreadList />)
    await endProject(user, '電子紙')
    await user.type(screen.getByRole('textbox', { name: '搜尋對話或專案' }), '電子紙')
    expect(within(list()).getByRole('button', { name: /電子紙排版/ })).toBeTruthy()
    expect(within(list()).getByText('已封存')).toBeTruthy()
  })

  it('取消封存：回到進行中清單，專案筆記改回原本的狀態', async () => {
    const { user } = renderV3(<ThreadList />)
    await endProject(user, '電子紙')
    await user.click(screen.getByRole('button', { name: /已封存的專案/ }))
    await user.click(screen.getByRole('button', { name: '取消封存「電子紙」' }))

    await waitFor(() => expect(within(list()).getByRole('button', { name: /電子紙排版/ })).toBeTruthy())
    expect(useThreadsStore.getState().archivedProjects).toEqual({})
    expect(files.get('40 專案/電子紙.md')).toBe(PROJECT_NOTE)
    expect(context.current.projects).toEqual([{ title: '搬家' }, { title: '電子紙' }])
    expect(screen.queryByRole('button', { name: /已封存的專案/ })).toBeNull()
  })

  it('搜尋時從封存專案的動作選單也能取消封存', async () => {
    const { user } = renderV3(<ThreadList />)
    await endProject(user, '電子紙')
    await user.type(screen.getByRole('textbox', { name: '搜尋對話或專案' }), '電子紙')
    await user.click(screen.getByRole('button', { name: '「電子紙」的專案動作' }))
    expect(screen.queryByRole('menuitem', { name: '結束專案…' })).toBeNull()
    await user.click(await screen.findByRole('menuitem', { name: '取消封存' }))
    await waitFor(() => expect(useThreadsStore.getState().archivedProjects).toEqual({}))
    expect(within(list()).queryByText('已封存')).toBeNull()
  })

  it('未分組沒有專案動作', () => {
    useThreadsStore.setState({ projectMap: { s1: '電子紙' } })
    renderV3(<ThreadList />)
    expect(screen.getByRole('button', { name: /未分組/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '「」的專案動作' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /的專案動作$/ })).toHaveLength(1)
  })
})
