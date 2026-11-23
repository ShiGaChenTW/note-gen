import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentTaskCenter } from '@/lib/agent-tasks/task-center'
import type { AgentTask } from '@/lib/agent-tasks/types'
import { projectProposals } from '@/lib/decide/project'
import { buildOrganizeDraft } from '@/lib/organize/drafts'
import { createOpsService } from '@/lib/ops/service'
import { createMemoryOpsIo, createMemoryOpsStore } from '@/lib/ops/testing'
import useCollectStore from '@/stores/collect'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import type { Proposal } from '@/lib/collect/types'
import { autoAcceptTaskDrafts, autoAcceptWorkspace } from './auto-accept-runtime'
import { useAutoAcceptSettings } from './auto-accept-settings'

const fake = vi.hoisted(() => ({ applyOps: vi.fn(), get: vi.fn(), set: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  isTauri: () => true,
}))
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => fake } }))
vi.mock('@/lib/organize/vault-io', () => ({
  currentWorkspaceIdentity: async () => '/fixture',
  inspectNote: async () => ({ mtime: 100 }),
}))
vi.mock('@/lib/ops/runtime', () => ({ applyOps: fake.applyOps }))

const path = '筆記/番茄鐘.md'
const before = '# 番茄鐘\n\n注意力殘留很常見。\n'
const after = before.replace('注意力殘留', '[[注意力殘留]]')
const proposal: Proposal = {
  id: 'link', kind: 'note', title: '補連結', body: '', due: '', time: '', tags: [],
  card: { label: 'note', verb: 'supplement' }, drafter: { role: 'expert', agentId: 'alex' },
  edits: [{ path, baseContent: before, content: after, summary: '補連結' }],
}
const newNote: Proposal = { id: 'new', kind: 'note', title: '新筆記', body: '新內容', due: '', time: '', tags: [] }
const workbench = (tasks: AgentTask[] = []) =>
  projectProposals({ items: useCollectStore.getState().items, tasks, journal: null, workspace: '/fixture' })

beforeEach(() => {
  vi.resetAllMocks()
  useCollectStore.setState({ items: [] })
  useSettingStore.setState({ workspacePath: '/fixture' })
  useSettingsHydrationStore.setState({ status: 'ready' })
  useAutoAcceptSettings.setState({ enabled: true, ready: false })
})

describe('自動接受送審入口', () => {
  it('只把需要 Scott 接受的收集提案送進等你清單，重複提交共用同一筆寫入', async () => {
    const io = createMemoryOpsIo({ [path]: before })
    const store = createMemoryOpsStore()
    fake.applyOps.mockImplementation(createOpsService({ ...io, store }).applyOps)
    const collect = useCollectStore.getState()
    const submit = collect.addProposals('batch', '專家', [proposal, newNote])
    expect(collect.addProposals('batch', '專家', [proposal, newNote])).toBe(submit)
    expect(workbench()).toEqual([])
    await submit
    expect(io.files[path]).toBe(after)
    expect(fake.applyOps).toHaveBeenCalledTimes(1)
    expect(store.rows[0]).toMatchObject({ proposalId: 'collect:batch:link', actor: 'expert', actorId: 'alex' })
    expect(workbench().map(item => item.key)).toEqual(['collect:batch:new'])
  })

  it('儲存關閉設定並重新載入後，低風險提案與其他提案逐張待審', async () => {
    let saved: boolean | undefined
    fake.get.mockImplementation(async () => saved)
    fake.set.mockImplementation(async (_, value: boolean) => { saved = value })
    await useAutoAcceptSettings.getState().load()
    expect(useAutoAcceptSettings.getState().enabled).toBe(true)
    await useAutoAcceptSettings.getState().setEnabled(false)
    expect(fake.set).toHaveBeenCalledWith('almanacAutoAcceptLinks', false)
    expect(fake.save).toHaveBeenCalled()
    useAutoAcceptSettings.setState({ enabled: true, ready: false })
    await useCollectStore.getState().addProposals('batch', '專家', [proposal, newNote])
    expect(fake.applyOps).not.toHaveBeenCalled()
    expect(workbench().map(item => item.key)).toEqual(['collect:batch:link', 'collect:batch:new'])
  })

  it('連結之外還會改歸屬或打標的提案保留人工接受', async () => {
    await useCollectStore.getState().addProposals('batch', '專家', [
      { ...proposal, id: 'membership', membershipTransfers: [{ from: 'a.md', to: path }] },
      { ...proposal, id: 'journal', edits: [{ ...proposal.edits![0], path: '筆記/另一則.md' }], journalTag: { confidence: 'high' } },
    ])
    expect(workbench()).toHaveLength(2)
    expect(fake.applyOps).not.toHaveBeenCalled()
  })

  it('任務中心在發佈自動整理草稿之前套用低風險連結，標籤草稿照常待審', async () => {
    const io = createMemoryOpsIo({ [path]: before })
    const store = createMemoryOpsStore()
    fake.applyOps.mockImplementation(createOpsService({ ...io, store }).applyOps)
    const center = new AgentTaskCenter({
      createRuntime: () => { throw new Error('No model expected') },
      persist: async () => {}, load: async () => [], remove: async () => {}, concurrency: async () => 1,
      notify: () => {}, now: () => 100, reviewWorkspace: autoAcceptWorkspace, autoAcceptDrafts: autoAcceptTaskDrafts,
    })
    const link = buildOrganizeDraft({
      kind: 'link', path, key: 'link', detail: '注意力殘留', changes: [{ path, before, after }], mtimes: { [path]: 100 },
    }, '/fixture', '/fixture', '補連結')
    const tag = buildOrganizeDraft({
      kind: 'tag', path, key: 'tag', detail: '注意力', changes: [{ path, before, after: '# 注意力\n' + before }], mtimes: { [path]: 100 },
    }, '/fixture', '/fixture', '補標籤')
    const published = vi.fn()
    center.subscribe(published)
    await center.submitDrafts({ kind: 'organize', title: '整理', drafts: [link, tag] })
    expect(io.files[path]).toBe(after)
    const [task] = center.list()
    expect(task.status).toBe('awaiting_review')
    expect(task.drafts.map(draft => draft.state)).toEqual(['applied', 'pending'])
    expect(published).toHaveBeenCalledTimes(2)
    expect(workbench(center.list()).map(item => item.key)).toEqual([`draft:${task.id}:${tag.id}`])
  })
})
