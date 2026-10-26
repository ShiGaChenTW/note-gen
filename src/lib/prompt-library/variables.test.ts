import { describe, expect, it } from 'vitest'
import {
  declaredVariableNames,
  extractVariableUsages,
  parseVariablesSection,
  renderPromptBody,
  resolvePromptFields,
  stripVariablesSection,
} from './variables'

describe('extractVariableUsages', () => {
  it('finds a user variable', () => {
    const usages = extractVariableUsages('Hello {{name}}!')
    expect(usages).toEqual([{ kind: 'user', token: 'name', name: 'name' }])
  })

  it('dedupes repeated tokens, keeping first-seen order', () => {
    const usages = extractVariableUsages('{{b}} {{a}} {{b}}')
    expect(usages.map(u => u.token)).toEqual(['b', 'a'])
  })

  it('skips escaped tokens', () => {
    expect(extractVariableUsages('\\{{name}}')).toEqual([])
  })

  it('skips tokens inside a fenced code block', () => {
    const body = ['```', '{{name}}', '```'].join('\n')
    expect(extractVariableUsages(body)).toEqual([])
  })

  it('skips tokens inside inline code', () => {
    expect(extractVariableUsages('use `{{name}}` here')).toEqual([])
  })

  it('still finds variables outside of a fenced block', () => {
    const body = ['{{outside}}', '```', '{{inside}}', '```', '{{after}}'].join('\n')
    expect(extractVariableUsages(body).map(u => u.token)).toEqual(['outside', 'after'])
  })

  it('recognizes built-in date with an optional format arg', () => {
    expect(extractVariableUsages('{{date}}')).toEqual([{ kind: 'builtin', token: 'date', builtin: 'date', arg: undefined }])
    expect(extractVariableUsages('{{date:YYYY/MM}}')).toEqual([{ kind: 'builtin', token: 'date:YYYY/MM', builtin: 'date', arg: 'YYYY/MM' }])
  })

  it('recognizes built-in time and clipboard', () => {
    expect(extractVariableUsages('{{time}}')).toEqual([{ kind: 'builtin', token: 'time', builtin: 'time' }])
    expect(extractVariableUsages('{{clipboard}}')).toEqual([{ kind: 'builtin', token: 'clipboard', builtin: 'clipboard' }])
  })

  it('recognizes built-in note:filename', () => {
    expect(extractVariableUsages('{{note:日記}}')).toEqual([{ kind: 'builtin', token: 'note:日記', builtin: 'note', arg: '日記' }])
  })

  it('treats a bare "note" (no filename) as a user variable', () => {
    expect(extractVariableUsages('{{note}}')).toEqual([{ kind: 'user', token: 'note', name: 'note' }])
  })

  it('treats "time" or "clipboard" with an argument as a user variable', () => {
    expect(extractVariableUsages('{{time:HH}}')).toEqual([{ kind: 'user', token: 'time:HH', name: 'time:HH' }])
  })
})

describe('parseVariablesSection', () => {
  it('parses description, default value and options per variable', () => {
    const body = [
      '# 提示詞',
      '',
      '內容 {{topic}} {{tone}}',
      '',
      '## 變數',
      '',
      '### topic',
      '這是主題',
      '- 預設值：寫作',
      '',
      '### tone',
      '語氣',
      '- 選項：正式, 輕鬆、幽默',
    ].join('\n')
    const declarations = parseVariablesSection(body)
    expect(declarations.get('topic')).toEqual({ name: 'topic', description: '這是主題', defaultValue: '寫作', options: [] })
    expect(declarations.get('tone')).toEqual({ name: 'tone', description: '語氣', defaultValue: '', options: ['正式', '輕鬆', '幽默'] })
  })

  it('returns an empty map when there is no "## 變數" heading', () => {
    expect(parseVariablesSection('no section here').size).toBe(0)
  })

  it('does not treat a heading with extra text as the variables section', () => {
    expect(parseVariablesSection('## 變數說明\n### x\n說明').size).toBe(0)
  })
})

describe('stripVariablesSection', () => {
  it('removes the "## 變數" section but keeps everything else', () => {
    const body = ['正文', '', '## 變數', '', '### x', '說明', '', '## 其他'].join('\n')
    expect(stripVariablesSection(body)).toBe(['正文', '', '## 其他'].join('\n'))
  })

  it('removes to end of document when "## 變數" is the last section', () => {
    const body = ['正文', '', '## 變數', '', '### x', '說明'].join('\n')
    expect(stripVariablesSection(body)).toBe('正文\n\n')
  })

  it('is a no-op when there is no "## 變數" section', () => {
    expect(stripVariablesSection('just text')).toBe('just text')
  })
})

describe('declaredVariableNames', () => {
  it('reads a flat string array', () => {
    expect(declaredVariableNames(['a', 'b'])).toEqual(new Set(['a', 'b']))
  })

  it('ignores non-array or non-string values', () => {
    expect(declaredVariableNames(undefined).size).toBe(0)
    expect(declaredVariableNames(['a', 1, null]).has('a')).toBe(true)
    expect(declaredVariableNames(['a', 1, null]).size).toBe(1)
  })
})

describe('resolvePromptFields', () => {
  const body = [
    '寫一篇關於 {{topic}} 的文章，語氣要 {{tone}}。今天是 {{date}}。',
    '',
    '## 變數',
    '',
    '### topic',
    '文章主題',
    '- 預設值：寫作',
  ].join('\n')

  it('marks declared variables as optional with their default/description, and others as required', () => {
    const fields = resolvePromptFields(body, ['topic'])
    expect(fields).toEqual([
      { name: 'topic', declared: true, required: false, description: '文章主題', defaultValue: '寫作', options: [] },
      { name: 'tone', declared: false, required: true, description: '', defaultValue: '', options: [] },
    ])
  })

  it('excludes built-in variables from the form fields', () => {
    const fields = resolvePromptFields(body, ['topic'])
    expect(fields.some(f => f.name === 'date')).toBe(false)
  })
})

describe('renderPromptBody', () => {
  it('substitutes user variables and built-ins', () => {
    const now = new Date(2026, 0, 2, 9, 5)
    const out = renderPromptBody('{{topic}} / {{date}} / {{time}}', {
      now,
      values: { topic: '寫作' },
    })
    expect(out).toBe('寫作 / 2026-01-02 / 09:05')
  })

  it('reads clipboard and another note via the injected callbacks', () => {
    const out = renderPromptBody('{{clipboard}} / {{note:日記}}', {
      now: new Date(),
      clipboardText: '剪貼簿內容',
      readNote: name => (name === '日記' ? '日記內文' : null),
      values: {},
    })
    expect(out).toBe('剪貼簿內容 / 日記內文')
  })

  it('unescapes \\{{x}} to a literal {{x}} without substituting it', () => {
    const out = renderPromptBody('\\{{topic}} {{topic}}', { now: new Date(), values: { topic: 'A' } })
    expect(out).toBe('{{topic}} A')
  })

  it('leaves tokens inside code untouched', () => {
    const out = renderPromptBody('`{{topic}}` and {{topic}}', { now: new Date(), values: { topic: 'A' } })
    expect(out).toBe('`{{topic}}` and A')
  })

  it('fills an unset user variable with an empty string', () => {
    expect(renderPromptBody('{{topic}}', { now: new Date(), values: {} })).toBe('')
  })
})
