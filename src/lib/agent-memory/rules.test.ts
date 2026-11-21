// Fork（almanac ALMNC-54.3）：活動紀錄格式、目前脈絡上限、90 天封存、寫入權限、範本與提示的純函式測試。
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_NOTE_MAX, buildMemoryPrompt, decideActivityWrite, decideAgentMemoryWrite, decideContextWrite,
  decidePreferencesWrite, defaultRules, defaultSoul, EMPTY_CONTEXT, parseContextLines, formatContextLines,
  selectActivityToArchive, trimForPrompt, validateActivityEntry, validateSharedContext,
  type ActivityEntryInput, type MemoryActor,
} from '.'

const DAY = 24 * 60 * 60 * 1000
const valid: ActivityEntryInput = {
  actorId: 'leo', actorRole: 'secretary', action: 'created',
  targetLink: 'task:42', source: { kind: 'conversation', ref: 'conv-1' }, note: '新增會議',
}
const commander: MemoryActor = { agentId: 'mia', role: 'commander' }
const secretary: MemoryActor = { agentId: 'leo', role: 'secretary' }
const expert: MemoryActor = { agentId: 'alex', role: 'expert' }

describe('activity log format (AC3)', () => {
  it('accepts the fixed fields and trims them', () => {
    expect(validateActivityEntry({ ...valid, targetLink: '  [[11/19 會議紀錄]] ' })).toEqual({
      ok: true,
      entry: {
        actorId: 'leo', actorRole: 'secretary', action: 'created', targetLink: '[[11/19 會議紀錄]]',
        sourceKind: 'conversation', sourceRef: 'conv-1', note: '新增會議', correctsId: null,
      },
    })
    expect(validateActivityEntry({ ...valid, actorId: 'scott', actorRole: 'scott', action: 'instructed', note: undefined }))
      .toMatchObject({ ok: true, entry: { note: '' } })
  })

  it('rejects entries without a target link', () => {
    expect(validateActivityEntry({ ...valid, targetLink: '' })).toEqual({ ok: false, error: 'TARGET_LINK_REQUIRED' })
    expect(validateActivityEntry({ ...valid, targetLink: '   ' })).toEqual({ ok: false, error: 'TARGET_LINK_REQUIRED' })
    expect(validateActivityEntry({ ...valid, targetLink: '開了一個會' })).toEqual({ ok: false, error: 'TARGET_LINK_INVALID' })
  })

  it('limits free text to 60 characters, counting CJK and emoji as one', () => {
    expect(validateActivityEntry({ ...valid, note: '字'.repeat(ACTIVITY_NOTE_MAX) }).ok).toBe(true)
    expect(validateActivityEntry({ ...valid, note: '😀'.repeat(ACTIVITY_NOTE_MAX) }).ok).toBe(true)
    expect(validateActivityEntry({ ...valid, note: '字'.repeat(ACTIVITY_NOTE_MAX + 1) })).toEqual({ ok: false, error: 'NOTE_TOO_LONG' })
  })

  it('requires actor, role, action and source, and rejects extra fields', () => {
    expect(validateActivityEntry({ ...valid, actorId: ' ' })).toEqual({ ok: false, error: 'ACTOR_REQUIRED' })
    expect(validateActivityEntry({ ...valid, actorRole: 'scott' })).toEqual({ ok: false, error: 'ACTOR_ROLE_INVALID' })
    expect(validateActivityEntry({ ...valid, actorRole: 'boss' as never })).toEqual({ ok: false, error: 'ACTOR_ROLE_INVALID' })
    expect(validateActivityEntry({ ...valid, action: 'deleted' as never })).toEqual({ ok: false, error: 'ACTION_INVALID' })
    expect(validateActivityEntry({ ...valid, source: { kind: 'conversation', ref: '' } })).toEqual({ ok: false, error: 'SOURCE_REQUIRED' })
    expect(validateActivityEntry({ ...valid, source: { kind: 'memory' as never, ref: 'x' } })).toEqual({ ok: false, error: 'SOURCE_REQUIRED' })
    expect(validateActivityEntry({ ...valid, at: 1 } as never)).toEqual({ ok: false, error: 'UNKNOWN_FIELD' })
  })

  it('corrections are new entries pointing at the old one', () => {
    expect(validateActivityEntry({ ...valid, action: 'corrected', correctsId: 7 })).toMatchObject({ ok: true, entry: { correctsId: 7 } })
    expect(validateActivityEntry({ ...valid, action: 'corrected' })).toEqual({ ok: false, error: 'CORRECTION_TARGET_REQUIRED' })
    expect(validateActivityEntry({ ...valid, correctsId: 7 })).toEqual({ ok: false, error: 'CORRECTION_ACTION_REQUIRED' })
  })
})

describe('current context limits (AC4)', () => {
  const items = (count: number) => Array.from({ length: count }, (_, index) => ({ title: `P${index}` }))

  it('allows up to 10 projects and 5 focus items, and rejects more', () => {
    expect(validateSharedContext({ ...EMPTY_CONTEXT, projects: items(10), weeklyFocus: items(5) }).ok).toBe(true)
    expect(validateSharedContext({ ...EMPTY_CONTEXT, projects: items(11) })).toEqual({ ok: false, error: 'TOO_MANY_PROJECTS' })
    expect(validateSharedContext({ ...EMPTY_CONTEXT, weeklyFocus: items(6) })).toEqual({ ok: false, error: 'TOO_MANY_FOCUS' })
  })

  it('normalizes titles, links and people', () => {
    expect(validateSharedContext({
      projects: [{ title: ' Almanac ', link: ' [[Almanac]] ' }], weeklyFocus: [{ title: 'V3', link: ' ' }], people: [' A ', 'A', ''],
    })).toEqual({ ok: true, context: { projects: [{ title: 'Almanac', link: '[[Almanac]]' }], weeklyFocus: [{ title: 'V3' }], people: ['A'] } })
    expect(validateSharedContext({ ...EMPTY_CONTEXT, projects: [{ title: ' ' }] })).toEqual({ ok: false, error: 'TITLE_REQUIRED' })
  })

  it('parses and formats the settings text box (title | link per line)', () => {
    const parsed = parseContextLines('Almanac | [[Almanac]]\n\n  NoteGen  \n')
    expect(parsed).toEqual([{ title: 'Almanac', link: '[[Almanac]]' }, { title: 'NoteGen' }])
    expect(formatContextLines(parsed)).toBe('Almanac | [[Almanac]]\nNoteGen')
  })
})

describe('90-day archive (AC4)', () => {
  it('selects only unarchived entries older than 90 days', () => {
    const now = 1000 * DAY
    expect(selectActivityToArchive([
      { id: 1, at: now - 91 * DAY, archivedAt: null },
      { id: 2, at: now - 90 * DAY, archivedAt: null },
      { id: 3, at: now - 200 * DAY, archivedAt: now - 100 * DAY },
      { id: 4, at: now, archivedAt: null },
    ], now)).toEqual([1])
  })
})

describe('write permissions (AC1, AC2, AC5)', () => {
  it('soul.md: only Scott', () => {
    expect(decideAgentMemoryWrite('scott', { agentId: 'mia', kind: 'soul' }, 'a', 'b')).toEqual({ decision: 'allow' })
    expect(decideAgentMemoryWrite(commander, { agentId: 'mia', kind: 'soul' }, 'a', 'b')).toEqual({ decision: 'deny', reason: 'SOUL_SCOTT_ONLY' })
    expect(decideAgentMemoryWrite('system', { agentId: 'mia', kind: 'soul' }, 'a', 'b')).toEqual({ decision: 'deny', reason: 'SOUL_SCOTT_ONLY' })
  })

  it('rules.md: Scott directly, agents only through a proposal', () => {
    expect(decideAgentMemoryWrite('scott', { agentId: 'leo', kind: 'rules' }, 'a', 'b')).toEqual({ decision: 'allow' })
    expect(decideAgentMemoryWrite(secretary, { agentId: 'leo', kind: 'rules' }, 'old', 'new')).toEqual({
      decision: 'propose', proposal: { kind: 'rules-change', agentId: 'leo', proposedBy: 'leo', before: 'old', after: 'new' },
    })
    expect(decideAgentMemoryWrite(commander, { agentId: 'alex', kind: 'rules' }, '', 'draft')).toMatchObject({ decision: 'propose' })
    expect(decideAgentMemoryWrite(expert, { agentId: 'leo', kind: 'rules' }, 'a', 'b')).toEqual({ decision: 'deny', reason: 'RULES_NOT_YOURS' })
  })

  it('work notes: the agent itself or Scott', () => {
    expect(decideAgentMemoryWrite(expert, { agentId: 'alex', kind: 'work_notes' }, '', 'x')).toEqual({ decision: 'allow' })
    expect(decideAgentMemoryWrite('scott', { agentId: 'alex', kind: 'work_notes' }, '', 'x')).toEqual({ decision: 'allow' })
    expect(decideAgentMemoryWrite(commander, { agentId: 'alex', kind: 'work_notes' }, '', 'x'))
      .toEqual({ decision: 'deny', reason: 'WORK_NOTES_NOT_YOURS' })
  })

  it('current context: commander or Scott; other agents must log an activity instead', () => {
    expect(decideContextWrite('scott')).toEqual({ decision: 'allow' })
    expect(decideContextWrite(commander)).toEqual({ decision: 'allow' })
    expect(decideContextWrite(secretary)).toEqual({ decision: 'deny', reason: 'CONTEXT_COMMANDER_ONLY' })
    expect(decideContextWrite('system')).toEqual({ decision: 'deny', reason: 'CONTEXT_COMMANDER_ONLY' })
  })

  it('activity log: system only', () => {
    expect(decideActivityWrite('system')).toEqual({ decision: 'allow' })
    expect(decideActivityWrite('scott')).toEqual({ decision: 'deny', reason: 'ACTIVITY_SYSTEM_ONLY' })
    expect(decideActivityWrite(commander)).toEqual({ decision: 'deny', reason: 'ACTIVITY_SYSTEM_ONLY' })
  })

  it("Scott's preferences: only Scott", () => {
    expect(decidePreferencesWrite('scott')).toEqual({ decision: 'allow' })
    for (const actor of ['system', commander, secretary] as const) {
      expect(decidePreferencesWrite(actor)).toEqual({ decision: 'deny', reason: 'PREFERENCES_SCOTT_ONLY' })
    }
  })
})

describe('templates and prompt', () => {
  it('soul.md starts with name, role, domain (experts only), colour and tone', () => {
    const soul = defaultSoul({ name: 'Alex', role: 'expert', domain: '工業工程' })
    expect(soul).toContain('本名：Alex')
    expect(soul).toContain('角色：工業工程專家')
    expect(soul).toContain('負責領域：工業工程')
    expect(soul).toMatch(/代表色：#[0-9A-F]{6}/)
    expect(soul).toContain('語氣：')
    expect(defaultSoul({ name: 'Mia', role: 'commander' })).not.toContain('負責領域')
    expect(defaultRules({ role: 'commander' })).toContain('你負責維護目前脈絡')
    expect(defaultRules({ role: 'secretary' })).toContain('寫一筆活動紀錄回報')
  })

  it('includes memory, preferences and context titles only, trimmed', () => {
    const prompt = buildMemoryPrompt({
      soul: 'S', rules: 'R', workNotes: '', scottPreferences: '回覆用繁體中文',
      context: { projects: [{ title: 'Almanac', link: '[[Almanac]]' }], weeklyFocus: [], people: ['A'] },
    })
    expect(prompt).toContain('soul.md)\nS')
    expect(prompt).toContain('回覆用繁體中文')
    expect(prompt).toContain('Active projects: Almanac')
    expect(prompt).not.toContain('[[Almanac]]')
    expect(prompt).not.toContain('work notes')
    expect(buildMemoryPrompt({ soul: '', rules: '', workNotes: '', scottPreferences: '', context: EMPTY_CONTEXT })).toBe('')
    expect(trimForPrompt('字'.repeat(10), 4)).toBe('字字字字\n…(truncated)')
  })
})
