// Fork（almanac ALMNC-54.12）：applyEdits 的預設 I/O——筆記庫（daily/note-io）、領域表（db/v3-domains）、
// Agent 設定區（db/agent-memory，以 Scott 的身分寫入：接受提案＝Scott 本人決定）。需要 Tauri，所以不寫單元測試。
import type { EditIo } from './apply'

export async function defaultEditIo(): Promise<EditIo> {
  const [noteIo, domains, memory] = await Promise.all([
    import('@/lib/daily/note-io'),
    import('@/db/v3-domains'),
    import('@/db/agent-memory'),
  ])
  return {
    readNote: noteIo.readNote,
    writeNote: noteIo.writeNote,
    removeNote: async path => {
      const [{ remove }, { getFilePathOptions }] = await Promise.all([import('@tauri-apps/plugin-fs'), import('@/lib/workspace')])
      const options = await getFilePathOptions(path)
      if (options.baseDir) await remove(options.path, { baseDir: options.baseDir })
      else await remove(options.path)
    },
    getDomainOverview: async id => (await domains.listDomains()).find(domain => domain.id === id)?.overview,
    setDomainOverview: async (id, overview) => { await domains.updateDomain(id, { overview }) },
    getWorkNotes: async agent => (await memory.getAgentMemory(agent)).workNotes.content,
    setWorkNotes: async (agent, content) => { await memory.writeAgentMemory('scott', agent, 'work_notes', content) },
    getRules: async agent => (await memory.getAgentMemory(agent)).rules.content,
    setRules: async (agent, content) => { await memory.writeAgentMemory('scott', agent, 'rules', content) },
    getContext: async () => {
      const { projects, weeklyFocus, people } = await memory.getSharedContext()
      return { projects, weeklyFocus, people }
    },
    setContext: context => memory.saveSharedContext('scott', context),
  }
}
