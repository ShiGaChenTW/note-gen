import { describe, expect, it } from 'vitest'
import {
  classifyUnifiedRecordInput,
  resolveUnifiedRecordType,
  resolveUnifiedRecordShortcut,
  resolveUnifiedTodoDraft,
  normalizeUnifiedLinkUrl,
  unifiedRecordTypes,
} from './unified-record-input'

describe('classifyUnifiedRecordInput', () => {
  it('classifies a standalone HTTP(S) URL as a link', () => {
    expect(classifyUnifiedRecordInput(' https://example.com/article ')).toBe('link')
  })

  it('keeps prose, multiple URLs, and non-HTTP URLs as text', () => {
    expect(classifyUnifiedRecordInput('Read https://example.com first')).toBe('text')
    expect(classifyUnifiedRecordInput('https://one.example https://two.example')).toBe('text')
    expect(classifyUnifiedRecordInput('mailto:hello@example.com')).toBe('text')
  })
})

describe('resolveUnifiedRecordShortcut', () => {
  it('maps fixed command number shortcuts to the approved record types', () => {
    expect(unifiedRecordTypes).toEqual([
      'link', 'text', 'image', 'file', 'recording', 'scan', 'todo', 'prompt-draft',
    ])
    expect(resolveUnifiedRecordShortcut({ key: '1', metaKey: true }, 'macos')).toBe('link')
    expect(resolveUnifiedRecordShortcut({ key: '8', metaKey: true }, 'macos')).toBe('prompt-draft')
    expect(resolveUnifiedRecordShortcut({ key: '0', metaKey: true }, 'macos')).toBe('auto')
  })

  it('matches the physical digit key when an input method changes the key value', () => {
    expect(resolveUnifiedRecordShortcut({ key: 'ㄅ', code: 'Digit1', metaKey: true }, 'macos')).toBe('link')
    expect(resolveUnifiedRecordShortcut({ key: 'ㄢ', code: 'Digit0', metaKey: true }, 'macos')).toBe('auto')
    expect(resolveUnifiedRecordShortcut({ key: 'ㄅ', code: 'KeyB', metaKey: true }, 'macos')).toBeNull()
    expect(resolveUnifiedRecordShortcut({ key: '7', code: 'Numpad7', metaKey: true }, 'macos')).toBe('todo')
  })

  it('requires the platform modifier and ignores composition or repeated key events', () => {
    expect(resolveUnifiedRecordShortcut({ key: '1', metaKey: true, isComposing: true }, 'macos')).toBeNull()
    expect(resolveUnifiedRecordShortcut({ key: '1', metaKey: true, repeat: true }, 'macos')).toBeNull()
    expect(resolveUnifiedRecordShortcut({ key: '1', altKey: true }, 'macos')).toBeNull()
    expect(resolveUnifiedRecordShortcut({ key: '2', altKey: true }, 'windows')).toBe('text')
  })
})

describe('resolveUnifiedRecordType', () => {
  it('uses classification only in automatic mode and preserves a manual choice', () => {
    expect(resolveUnifiedRecordType('auto', 'https://example.com')).toBe('link')
    expect(resolveUnifiedRecordType('auto', 'a note containing https://example.com')).toBe('text')
    expect(resolveUnifiedRecordType('todo', 'https://example.com')).toBe('todo')
  })
})

describe('resolveUnifiedTodoDraft', () => {
  const emptyTodo = { title: '', description: '', priority: 'high' as const }

  it('turns the shared draft into a title and description when the form is empty', () => {
    expect(resolveUnifiedTodoDraft('買牛奶\n要低脂\n兩瓶', emptyTodo)).toEqual({
      title: '買牛奶',
      description: '要低脂\n兩瓶',
      priority: 'high',
    })
  })

  it('keeps the shared draft as the description when a title was typed', () => {
    expect(resolveUnifiedTodoDraft('細節', { ...emptyTodo, title: ' 標題 ' })).toEqual({
      title: '標題',
      description: '細節',
      priority: 'high',
    })
  })

  it('does not overwrite explicit form fields and returns an empty title for an empty draft', () => {
    expect(resolveUnifiedTodoDraft('草稿', { title: '標題', description: '說明', priority: 'low' })).toEqual({
      title: '標題',
      description: '說明\n\n草稿',
      priority: 'low',
    })
    expect(resolveUnifiedTodoDraft('   ', emptyTodo).title).toBe('')
  })
})

describe('normalizeUnifiedLinkUrl', () => {
  it('adds https only when the protocol is missing', () => {
    expect(normalizeUnifiedLinkUrl(' example.com/a ')).toBe('https://example.com/a')
    expect(normalizeUnifiedLinkUrl('HTTP://example.com')).toBe('HTTP://example.com')
  })
})
