// Fork（almanac ALMNC-54.7）：經過 AgentRuntime 的完整一輪——模型拿到的系統提示詞是指揮官的、拿到的工具沒有寫檔工具；
// 模型改筆記只會產生提案，原本的寫檔工具一次都沒執行。mock 的寫法同 agents/runner.test.ts。
import { describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '@/lib/agent/types'

const { request, execute } = vi.hoisted(() => ({ request: vi.fn(), execute: vi.fn<AgentTool['execute']>() }))

const makeTool = (name: string, risk: AgentTool['risk'], category: AgentTool['category'] = 'note'): AgentTool => ({
  name, title: name, description: name, category, risk,
  inputSchema: { type: 'object', properties: { fileName: { type: 'string' }, filePath: { type: 'string' }, content: { type: 'string' } } },
  execute,
})

vi.mock('@/lib/daily/note-io', () => ({ readNote: async (path: string) => (path === 'a.md' ? '舊' : null) }))
vi.mock('@/lib/workspace', () => ({ getWorkspacePath: async () => ({ isCustom: true, path: '/test' }) }))
vi.mock('@/lib/skills/runtime', () => ({ getSkillWorkspaceIdentity: () => '/test', getSkillScriptPermissionKey: vi.fn() }))
vi.mock('@/lib/skills', () => ({ skillManager: {} }))
vi.mock('@/lib/context/loader', () => ({ memoryContextService: { formatMemoryContext: () => '' } }))
vi.mock('@/lib/mcp/agent-tools', () => ({ buildMcpAgentToolCatalog: () => ({ directTools: [], deferredEntries: [] }) }))
vi.mock('@/lib/rag-agent-policy', () => ({ getRagAgentPolicy: async () => ({ automaticSearchEnabled: false }) }))
vi.mock('@/lib/agent/tool-registry', () => ({
  agentToolRegistry: {
    listTools: () => [
      makeTool('note_read_file', 'read'), makeTool('note_create_file', 'file-create'), makeTool('note_update_file', 'file-update'),
      makeTool('note_delete_file', 'delete'), makeTool('editor_replace_lines', 'editor-write', 'editor'), makeTool('tag_create', 'medium', 'tag'),
    ],
    toOpenAITools: (tools: AgentTool[]) => tools.map(tool => ({ type: 'function', function: { name: tool.name } })),
  },
  LOADED_SKILL_TOOL_NAMES: new Set(),
  hasFileEditPreview: (name: string) => ['note_create_file', 'note_update_file', 'note_delete_file'].includes(name),
  buildEditorApprovalPreview: vi.fn(),
  validateEditApprovalPreview: async () => undefined,
}))
vi.mock('@/lib/ai/utils', () => ({
  getAISettings: async () => ({ model: 'fixture', baseURL: 'https://example.test' }),
  validateAIService: async (url: string) => url,
  getSystemPromptContent: async () => '',
  getChatTokenLimitParams: () => ({}),
  createOpenAIClient: async () => ({}),
  withFastAiRequestOptions: (params: unknown) => params,
  createAssistantToolCallMessage: (content: unknown, calls: unknown) => ({ role: 'assistant', content, tool_calls: calls }),
  createChatCompletionStreamWithToolChoiceFallback: async (_client: unknown, params: unknown) => request(params),
  handleAIError: async () => undefined,
}))

const { AgentRuntime } = await import('@/lib/agent/runtime')
const { prepareSidebarCommanderRun } = await import('./sidebar-session')

async function* toolCall(name: string, args: string) {
  yield { choices: [{ finish_reason: 'tool_calls', delta: { tool_calls: [{ index: 0, id: 'call-0', function: { name, arguments: args } }] } }] }
}
async function* finalReply() {
  yield { choices: [{ finish_reason: 'stop', delta: { content: '我提了一則提案。' } }] }
}

describe('sidebar commander through the agent runtime', () => {
  it('sends the commander prompt, offers no writers, and turns the note edit into a proposal', async () => {
    const submitProposals = vi.fn(async () => {})
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['把 a.md 改成新的'] }, {
      roster: async () => [{ id: 'c-1', name: 'Mia', role: 'commander', enabled: true }],
      memoryPrompt: async () => '- 本名：Mia',
      readFile: async path => (path === 'a.md' ? '舊' : null),
      writeSchedule: vi.fn(),
      submitProposals,
      attachCard: vi.fn(),
      attachDirectEdit: vi.fn(),
      logActivity: vi.fn(),
      roleLabel: key => (key === 'commander' ? '指揮官' : key),
      originLabel: agent => agent,
      now: () => new Date(2026, 10, 19),
    })
    request.mockImplementationOnce(() => toolCall('propose_note_update', '{"filePath":"a.md","content":"新"}')).mockImplementationOnce(finalReply)

    const confirm = vi.fn(async () => 'approved' as const)
    await new AgentRuntime().run({
      userInput: '把 a.md 改成新的',
      permissionMode: 'auto-edit',
      useMemories: false,
      selectedMcpServerIds: [],
      selectedSkills: [],
      activeFilePath: 'a.md',
      rolePrompt: run.rolePrompt,
      transformTools: run.transformTools,
    }, { requestConfirmation: confirm })

    const first = request.mock.calls[0][0]
    const system = first.messages.find((message: { role: string }) => message.role === 'system').content as string
    expect(system).toContain('Mia · 指揮官')
    expect(system).toContain('本名：Mia')
    const offered = first.tools.map((tool: { function: { name: string } }) => tool.function.name)
    expect(offered).toEqual(expect.arrayContaining(['note_read_file', 'propose_note_update', 'schedule_add_event']))
    for (const writer of ['note_create_file', 'note_update_file', 'note_delete_file', 'editor_replace_lines', 'tag_create']) expect(offered).not.toContain(writer)

    expect(execute).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    await run.finish()
    expect(submitProposals).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 7,
      proposals: [expect.objectContaining({ conversationId: 7, change: expect.objectContaining({ toolName: 'note_update_file', path: 'a.md', baseContent: '舊', content: '新' }) })],
    }))
  })
})
