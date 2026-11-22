// Fork（almanac ALMNC-54.7）：右側欄「處理」模式提供給模型的工具——沒有任何直接寫檔的工具；
// 筆記、資料夾（領域）的改動都變成提案（帶來源對話），不碰檔案。
import { describe, expect, it, vi } from 'vitest'
import { agentToolRegistry } from '@/lib/agent/tool-registry'
import type { AgentTool } from '@/lib/agent/types'
import type { ScheduleDeps } from './schedule-direct'
import { buildSidebarCommanderTools, changesToProposals, createChangeCollector, sidebarToolKind } from './sidebar'

const files = new Map<string, string>([['筆記/會議.md', '# 會議\n舊內容\n'], ['領域/工業工程.md', '---\ndomains: []\n---\n# 工業工程\n'], ['筆記/甲.md', '甲'], ['筆記/乙.md', '乙']])

function scheduleDeps(): ScheduleDeps {
  return {
    now: () => new Date(2026, 10, 19, 9),
    scottMessages: () => [],
    write: vi.fn(),
    onDirectEdit: vi.fn(),
    propose: vi.fn(),
    choiceAnswered: () => false,
  }
}

/** 真正的工具表，加上一個會改外部資料的 MCP 工具；所有 execute 換成會記錄呼叫的假函式（呼叫到就表示直接寫了）。 */
function catalog() {
  const writes: string[] = []
  const external: AgentTool = { name: 'mcp__notion__update_page', title: 'update', description: 'update', category: 'mcp', risk: 'external', inputSchema: { type: 'object' }, execute: async () => ({ ok: true, message: '' }) }
  const tools: AgentTool[] = [...agentToolRegistry.listTools(), external].map((tool): AgentTool => ({
    ...tool,
    execute: async () => {
      if (tool.risk !== 'read') writes.push(tool.name)
      return { ok: true, message: 'real tool ran' }
    },
  }))
  return { tools, writes }
}

function build() {
  const collector = createChangeCollector()
  const { tools, writes } = catalog()
  const offered = buildSidebarCommanderTools(tools, {
    collector,
    readFile: async path => files.get(path) ?? null,
    schedule: scheduleDeps(),
    onChoiceAnswered: vi.fn(),
  })
  return { collector, offered, writes, all: tools }
}

const context = { runId: 'test', context: { userInput: '' } }

describe('right sidebar commander tools', () => {
  it('offers no tool that writes directly: every tool is read-only, a proposal or a secretary schedule tool', () => {
    const { offered, all } = build()
    expect(all.length).toBeGreaterThan(60)
    for (const tool of offered) expect(sidebarToolKind(tool), tool.name).not.toBeNull()
    const names = offered.map(tool => tool.name)
    // 原本會直接改的工具：編輯器、畫布、標籤、記錄、記憶、技能、腳本、外部 MCP 寫入
    for (const writer of all.filter(tool => tool.risk !== 'read' && sidebarToolKind(tool) !== 'proposal')) {
      expect(names, writer.name).not.toContain(writer.name)
    }
    expect(names).toEqual(expect.arrayContaining(['note_read_file', 'propose_note_create', 'propose_note_update', 'propose_note_delete', 'propose_folder_create', 'schedule_add_task', 'schedule_add_event', 'ask_user_question']))
    // 原名的寫檔工具一個都不在（原名會被 runtime 當成改檔、顯示成已套用）
    for (const name of ['note_create_file', 'note_update_file', 'note_delete_file', 'note_rename_file', 'note_move_file', 'note_copy_file', 'folder_create', 'folder_delete', 'editor_replace_lines', 'editor_insert_at_cursor', 'canvas_apply_operations', 'tag_create', 'mark_create', 'memory_create', 'skill_run_code', 'mcp_call_tool', 'mcp__notion__update_page']) {
      expect(names).not.toContain(name)
    }
    expect(offered.filter(tool => sidebarToolKind(tool) === 'proposal').every(tool => tool.description.includes('becomes a proposal'))).toBe(true)
  })

  it('never runs the real writer: every proposal tool only records a change', async () => {
    const { offered, writes, collector } = build()
    const calls: Record<string, Record<string, unknown>> = {
      propose_note_create: { fileName: '新筆記.md', folderPath: '筆記', content: '# 新筆記\n' },
      propose_note_update: { filePath: '筆記/會議.md', content: '# 會議\n新內容\n' },
      propose_note_delete: { filePath: '筆記/會議.md' },
      propose_note_rename: { filePath: '領域/工業工程.md', newName: '產業工程.md' },
      propose_note_move: { filePath: '筆記/甲.md', targetFolderPath: '封存' },
      propose_note_copy: { filePath: '筆記/乙.md', targetFolderPath: '備份' },
      propose_folder_create: { folderPath: '領域/品質管理' },
    }
    for (const tool of offered.filter(entry => sidebarToolKind(entry) === 'proposal')) {
      const result = await tool.execute(calls[tool.name], context)
      expect(result.ok, `${tool.name}: ${result.message}`).toBe(true)
      expect(result.message).toMatch(/^Proposed \(not written\)/)
    }
    expect(writes).toEqual([])
    // 同一個檔案先改後刪，合併成一筆刪除
    expect(collector.changes().map(change => change.kind).sort()).toEqual(['copy', 'create', 'delete', 'folder', 'move', 'move'])
    expect(files.get('筆記/會議.md')).toBe('# 會議\n舊內容\n')
  })

  it('turns a note change and a domain change into proposals that remember the conversation', async () => {
    const { offered, collector, writes } = build()
    const update = offered.find(tool => tool.name === 'propose_note_update')!
    await update.execute({ filePath: '筆記/會議.md', content: '# 會議\n新內容\n' }, context)
    // 改筆記的領域＝改 frontmatter 的 domains，也是改筆記
    await update.execute({ filePath: '領域/工業工程.md', content: '---\ndomains: [ie]\n---\n# 工業工程\n' }, context)
    const proposals = changesToProposals(collector.changes(), { conversationId: 42, agentId: 'mia' })
    expect(writes).toEqual([])
    expect(files.get('筆記/會議.md')).toBe('# 會議\n舊內容\n')
    expect(proposals).toHaveLength(2)
    expect(proposals[0]).toMatchObject({
      kind: 'note',
      conversationId: 42,
      drafter: { role: 'commander', agentId: 'mia' },
      change: { kind: 'update', path: '筆記/會議.md', baseContent: '# 會議\n舊內容\n', content: '# 會議\n新內容\n', toolName: 'note_update_file' },
    })
    expect(proposals[1].change).toMatchObject({ path: '領域/工業工程.md', content: expect.stringContaining('domains: [ie]') })
  })

  it('merges repeated edits of one file into one proposal and reads proposed content back', async () => {
    const { offered, collector } = build()
    const create = offered.find(tool => tool.name === 'propose_note_create')!
    const update = offered.find(tool => tool.name === 'propose_note_update')!
    const read = offered.find(tool => tool.name === 'note_read_file')!
    await create.execute({ fileName: 'b.md', folderPath: '', content: 'one' }, context)
    await update.execute({ filePath: 'b.md', content: 'two' }, context)
    expect(collector.changes()).toEqual([expect.objectContaining({ kind: 'create', path: 'b.md', content: 'two' })])
    expect((await read.execute({ filePath: 'b.md' }, context)).data).toMatchObject({ content: 'two' })
  })

  it('refuses to propose an update to a file that does not exist', async () => {
    const { offered, collector } = build()
    const result = await offered.find(tool => tool.name === 'propose_note_update')!.execute({ filePath: 'nope.md', content: 'x' }, context)
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    expect(collector.changes()).toEqual([])
  })
})
