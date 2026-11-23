// Fork（almanac ALMNC-54.1）：筆記三類與 frontmatter 欄位（AC3、AC5）。
import { describe, expect, it } from 'vitest'
import { createV3Note, noteTitle, parseV3Note, writeV3NoteFields } from './note'

const FULL = `---
title: 資料管線要冪等
type: knowledge
summary: 重跑不該產生重複資料
sources: [src_1, src_2]
tags: [工程, 資料]
related: ["[[批次處理]]"]
domains: [eng, de]
status: valid
lastConfirmed: 2026-11-01
aliases: [冪等]
# 使用者自己的註解
custom: 保留我
---
# 資料管線要冪等

內文。
`

describe('解析 V3 筆記（AC3）', () => {
  it('讀出全部欄位，未知欄位放進 extra', () => {
    const note = parseV3Note(FULL)
    expect(note.fields).toEqual({
      title: '資料管線要冪等',
      type: 'knowledge',
      summary: '重跑不該產生重複資料',
      sources: ['src_1', 'src_2'],
      tags: ['工程', '資料'],
      related: ['[[批次處理]]'],
      domains: ['eng', 'de'],
      status: 'valid',
      lastConfirmed: '2026-11-01',
    })
    expect(note.extra).toEqual({ aliases: ['冪等'], custom: '保留我' })
    expect(note.body).toBe('# 資料管線要冪等\n\n內文。\n')
    expect(note.issues).toEqual([])
  })

  it.each(['knowledge', 'record', 'project'])('接受類型 %s', type => {
    expect(parseV3Note(`---\ntype: ${type}\n---\n`).fields.type).toBe(type)
  })

  it.each(['valid', 'disputed', 'superseded', 'archived'])('接受狀態 %s', status => {
    expect(parseV3Note(`---\nstatus: ${status}\n---\n`).fields.status).toBe(status)
  })

  it('一則筆記可以屬於多個領域；單一字串也當成一項（AC5）', () => {
    expect(parseV3Note('---\ndomains: [a, b, a]\n---\n').fields.domains).toEqual(['a', 'b'])
    expect(parseV3Note('---\ndomains: a\n---\n').fields.domains).toEqual(['a'])
  })

  it('沒有 frontmatter 時欄位為空、內文完整', () => {
    const note = parseV3Note('# 標題\n')
    expect(note.fields).toEqual({ sources: [], tags: [], related: [], domains: [] })
    expect(note.body).toBe('# 標題\n')
  })

  it('格式不對的欄位當成沒填並回報', () => {
    const note = parseV3Note('---\ntype: idea\nstatus: done\nlastConfirmed: 下週\nsources: 3\ntags: {a: 1}\n---\n')
    expect(note.fields.type).toBeUndefined()
    expect(note.fields.status).toBeUndefined()
    expect(note.fields.lastConfirmed).toBeUndefined()
    expect(note.fields.sources).toEqual([])
    expect(note.issues).toHaveLength(5)
  })

  it('YAML 壞掉時丟錯', () => {
    expect(() => parseV3Note('---\na: [\n---\n')).toThrow()
  })
})

describe('標題', () => {
  it('frontmatter → H1 → 檔名', () => {
    expect(noteTitle(parseV3Note(FULL))).toBe('資料管線要冪等')
    expect(noteTitle(parseV3Note('---\ntype: record\n---\n# 11/20 會議 #\n'))).toBe('11/20 會議')
    expect(noteTitle(parseV3Note('沒有標題'), '紀錄/2026-11-20 週會.md')).toBe('2026-11-20 週會')
  })
})

describe('寫回 V3 欄位', () => {
  it('只改指定欄位，保留未知欄位、註解與內文', () => {
    const next = writeV3NoteFields(FULL, { status: 'superseded', lastConfirmed: '2026-11-21', sources: ['src_1', 'src_3'] })
    expect(next).toContain('status: superseded')
    expect(next).toContain('lastConfirmed: 2026-11-21')
    expect(next).toContain('# 使用者自己的註解')
    expect(next).toContain('custom: 保留我')
    expect(next.endsWith('---\n# 資料管線要冪等\n\n內文。\n')).toBe(true)
    const reparsed = parseV3Note(next)
    expect(reparsed.fields.sources).toEqual(['src_1', 'src_3'])
    expect(reparsed.fields.summary).toBe('重跑不該產生重複資料')
    expect(reparsed.extra).toEqual({ aliases: ['冪等'], custom: '保留我' })
  })

  it('null 或空清單移除欄位；undefined 不動', () => {
    const next = parseV3Note(writeV3NoteFields(FULL, { summary: null, tags: [], title: undefined }))
    expect(next.fields.summary).toBeUndefined()
    expect(next.fields.tags).toEqual([])
    expect(next.fields.title).toBe('資料管線要冪等')
  })

  it('沒有 frontmatter 的筆記會新增一個', () => {
    const next = writeV3NoteFields('內文\n', { type: 'record', domains: ['life'] })
    expect(next).toBe('---\ntype: record\ndomains: [ life ]\n---\n內文\n')
    expect(parseV3Note(next).body).toBe('內文\n')
  })

  it('移除最後一個欄位時拿掉整個 frontmatter', () => {
    expect(writeV3NoteFields('---\ntype: record\n---\n內文\n', { type: null })).toBe('內文\n')
  })

  it('保留 BOM', () => {
    const next = writeV3NoteFields('﻿---\nfoo: 1\n---\nx', { type: 'project' })
    expect(next.startsWith('﻿---\n')).toBe(true)
    expect(parseV3Note(next).extra).toEqual({ foo: 1 })
  })

  it('拒絕不合法的類型、狀態與日期', () => {
    expect(() => writeV3NoteFields('', { type: 'idea' as never })).toThrow()
    expect(() => writeV3NoteFields('', { status: 'done' as never })).toThrow()
    expect(() => writeV3NoteFields('', { lastConfirmed: '2026/11/21' })).toThrow()
  })

  it('新筆記：欄位與內文組成完整 Markdown，可原樣讀回', () => {
    const raw = createV3Note({
      title: '週會', type: 'record', summary: '決定上線時程', sources: ['src_9'], tags: ['會議'],
      related: [], domains: ['eng', 'life'], status: 'valid', lastConfirmed: '2026-11-21',
    }, '---\n內文以分隔線開頭\n')
    const note = parseV3Note(raw)
    expect(note.fields).toEqual({
      title: '週會', type: 'record', summary: '決定上線時程', sources: ['src_9'], tags: ['會議'],
      related: [], domains: ['eng', 'life'], status: 'valid', lastConfirmed: '2026-11-21',
    })
    expect(note.body).toBe('---\n內文以分隔線開頭\n')
  })
})

// Fork（almanac ALMNC-69.1）：身分編號放 frontmatter 第一行。
describe('身分編號 id', () => {
  it('解析 id；格式不對時記為問題', () => {
    expect(parseV3Note('---\nid: N-20261110-063015-B3XR\n---\n').fields.id).toBe('N-20261110-063015-B3XR')
    const bad = parseV3Note('---\nid: src_1\n---\n')
    expect(bad.fields.id).toBeUndefined()
    expect(bad.issues[0]).toContain('id 必須是')
  })

  it('寫入時 id 一律放第一行，其他欄位與內文保留', () => {
    const raw = '---\ntitle: 甲\ncustom: 保留\n---\n# 甲\n'
    expect(writeV3NoteFields(raw, { id: 'N-20261110-063015-B3XR' })).toBe('---\nid: N-20261110-063015-B3XR\ntitle: 甲\ncustom: 保留\n---\n# 甲\n')
    expect(writeV3NoteFields('# 乙\n', { id: 'N-20261110-063015-B3XR' })).toBe('---\nid: N-20261110-063015-B3XR\n---\n# 乙\n')
    expect(createV3Note({ title: '丙', type: 'knowledge', id: 'N-20261110-063015-B3XR' }, '內文\n').startsWith('---\nid: N-20261110-063015-B3XR\ntitle: 丙\n')).toBe(true)
  })

  it('拒絕格式不對的 id', () => {
    expect(() => writeV3NoteFields('', { id: 'abc' })).toThrow('身分編號格式不對')
  })
})
