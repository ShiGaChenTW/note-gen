import { describe, expect, it } from 'vitest'
import { buildDailyNoteContent, normalizeNotePath, type NoteReader } from './daily-note-content'

// 2026-10-19 是星期一
const MONDAY = new Date(2026, 9, 19, 8, 5)
const TUESDAY = new Date(2026, 9, 20, 8, 5)

function reader(files: Record<string, string>): NoteReader {
  return async (path) => files[path] ?? null
}

describe('normalizeNotePath', () => {
  it.each([
    ['Templates/Daily', 'Templates/Daily.md'],
    ['Templates/Daily.md', 'Templates/Daily.md'],
    ['/Templates/Daily/', 'Templates/Daily.md'],
    ['  ', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeNotePath(input)).toBe(expected)
  })
})

describe('buildDailyNoteContent', () => {
  const files = {
    'T/Default.md': '# {{title}}\n{{weekday}} {{date:YYYY/MM/DD}} {{time}}\n',
    'T/Monday.md': '# Monday {{title}}\n',
    'Quotes.md': '---\ntags: [q]\n---\n\nOnly line\n',
  }
  const templates = { defaultTemplate: 'T/Default', weekdayTemplates: { monday: 'T/Monday' } }

  it('uses the weekday template on Monday', async () => {
    const content = await buildDailyNoteContent({
      now: MONDAY, notePath: '20 Journal/21 Daily/20261019.md', templates, readNote: reader(files),
    })
    expect(content).toBe('# Monday 20261019\n')
  })

  it('falls back to the default template on Tuesday', async () => {
    const content = await buildDailyNoteContent({
      now: TUESDAY, notePath: 'Daily/20261020.md', templates, readNote: reader(files),
    })
    expect(content).toBe('# 20261020\nTuesday 2026/10/20 08:05\n')
  })

  it('falls back to the default template when the weekday template file is missing', async () => {
    const content = await buildDailyNoteContent({
      now: MONDAY,
      notePath: 'Daily/20261019.md',
      templates: { defaultTemplate: 'T/Default', weekdayTemplates: { monday: 'T/Missing' } },
      readNote: reader(files),
    })
    expect(content.startsWith('# 20261019\nMonday')).toBe(true)
  })

  it('returns an empty note without templates or when none can be read', async () => {
    expect(await buildDailyNoteContent({
      now: MONDAY, notePath: 'd.md', templates: {}, readNote: reader(files),
    })).toBe('')
    expect(await buildDailyNoteContent({
      now: MONDAY, notePath: 'd.md', templates: { defaultTemplate: 'Nope' }, readNote: reader(files),
    })).toBe('')
  })

  it('expands {{random:...}} from the referenced note, skipping frontmatter', async () => {
    const content = await buildDailyNoteContent({
      now: TUESDAY,
      notePath: 'd.md',
      templates: { defaultTemplate: 'T/R' },
      readNote: reader({ ...files, 'T/R.md': '> {{random:Quotes}} / {{random:Missing}}' }),
      random: () => 0,
    })
    expect(content).toBe('> Only line / ')
  })
})
