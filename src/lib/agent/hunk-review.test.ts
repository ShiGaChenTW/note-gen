import { describe, expect, it } from 'vitest'
import { prepareEditorLineTransaction } from './editor-adapter'
import {
  buildDiffHunks,
  buildDiffSegments,
  composeAcceptedContent,
  describeHunkReview,
  findEditPreviewConflict,
  hunkReviewData,
  narrowEditPreviewToHunks,
  resolveHunkReview,
} from './hunk-review'
import { buildLineDiff } from './text-diff'

// 三處相隔很遠的改動：第 2 行改寫、第 12 行刪除、第 22 行後新增兩行。
const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`)
const before = `${lines.join('\n')}\n`
const after = `${lines.map((line, index) => index === 1 ? 'LINE TWO' : line)
  .filter((_, index) => index !== 11)
  .flatMap((line, index) => index === 20 ? [line, 'new A', 'new B'] : [line])
  .join('\n')}\n`
// 接受第 1、3 處、拒絕第 2 處應得到的內容（直接寫出，不靠被測的函式算）。
const acceptFirstAndThird = `${lines.map((line, index) => index === 1 ? 'LINE TWO' : line)
  .flatMap((line, index) => index === 21 ? [line, 'new A', 'new B'] : [line])
  .join('\n')}\n`

describe('buildDiffHunks', () => {
  it('切出與面板相同的處：相距遠的改動各自一處', () => {
    const { hunks } = buildDiffHunks(before, after)
    expect(hunks).toHaveLength(3)
    expect(hunks.map(hunk => [hunk.oldStart, hunk.oldEnd, hunk.added, hunk.removed, hunk.after])).toEqual([
      [2, 2, 1, 1, 1],
      [12, 12, 0, 1, 11],
      [undefined, undefined, 2, 0, 22],
    ])
  })

  it('面板的切段（buildDiffSegments）與套用用的處是同一份資料', () => {
    const { hunks } = buildDiffHunks(before, after)
    const visible = buildDiffSegments(buildLineDiff(before, after)).filter(segment => !segment.hidden)
    expect(visible.map(segment => [segment.from, segment.to])).toEqual(hunks.map(hunk => [hunk.from, hunk.to]))
  })

  it('前後文重疊的改動併成同一處', () => {
    const near = before.replace('line 5\n', 'line five\n').replace('line 9\n', 'line nine\n')
    expect(buildDiffHunks(before, near).hunks).toHaveLength(1)
  })
})

describe('composeAcceptedContent', () => {
  it('全部接受等於提議內容，全部拒絕等於原文', () => {
    expect(composeAcceptedContent(before, after, [0, 1, 2])).toBe(after)
    expect(composeAcceptedContent(before, after, [])).toBe(before)
  })

  it('部分接受：只寫入被接受的處，被拒絕的處維持原文', () => {
    const result = composeAcceptedContent(before, after, [0, 2])
    expect(result).toBe(acceptFirstAndThird)
    expect(result).toContain('line 12\n')
    expect(result).not.toContain('line 2\n')
  })

  it('只拒絕刪除那處時，被刪的行留下', () => {
    const result = composeAcceptedContent(before, after, [0, 2])
    expect(result.split('\n')).toContain('line 12')
    expect(composeAcceptedContent(before, after, [1])).toBe(before.replace('line 12\n', ''))
  })

  it('保留 CRLF 與檔尾沒有換行', () => {
    const crlfBefore = `${lines.join('\r\n')}`
    const crlfAfter = crlfBefore.replace('line 2\r\n', 'LINE TWO\r\n').replace(/line 30$/, 'line 30 end')
    const { hunks } = buildDiffHunks(crlfBefore, crlfAfter)
    expect(hunks).toHaveLength(2)
    expect(composeAcceptedContent(crlfBefore, crlfAfter, [0])).toBe(crlfBefore.replace('line 2\r\n', 'LINE TWO\r\n'))
    expect(composeAcceptedContent(crlfBefore, crlfAfter, [1])).toBe(crlfBefore.replace(/line 30$/, 'line 30 end'))
    expect(composeAcceptedContent(crlfBefore, crlfAfter, [1]).endsWith('line 30 end')).toBe(true)
  })

  it('隨機改動：全收得到提議內容、全拒得到原文、每處單獨接受都只動到那一處', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let round = 0; round < 40; round += 1) {
      const source = Array.from({ length: 40 }, (_, index) => `p${index % 7} ${index}`)
      const target = source.flatMap(line => {
        const roll = random()
        if (roll < 0.08) return []
        if (roll < 0.16) return [`${line} edited`]
        if (roll < 0.22) return [line, `inserted ${round}`]
        return [line]
      })
      const original = source.join('\n')
      const proposal = target.join('\n')
      const { hunks } = buildDiffHunks(original, proposal)
      expect(composeAcceptedContent(original, proposal, hunks.map(hunk => hunk.index))).toBe(proposal)
      expect(composeAcceptedContent(original, proposal, [])).toBe(original)
      for (const hunk of hunks) {
        const single = composeAcceptedContent(original, proposal, [hunk.index])
        const changed = buildLineDiff(original, single).filter(line => line.type === 'remove').map(line => line.oldLine)
        expect(changed.every(line => line !== undefined && hunk.oldStart !== undefined
          && line >= hunk.oldStart && line <= hunk.oldEnd!)).toBe(true)
      }
    }
  })
})

describe('resolveHunkReview', () => {
  it('沒有拒絕 = 全部接受；全部拒絕 = 拒絕整份；其餘列出被接受的處', () => {
    expect(resolveHunkReview(3, new Set())).toEqual({ kind: 'all' })
    expect(resolveHunkReview(3, new Set([0, 1, 2]))).toEqual({ kind: 'none' })
    expect(resolveHunkReview(3, new Set([1]))).toEqual({ kind: 'partial', accepted: [0, 2] })
    expect(resolveHunkReview(0, new Set())).toEqual({ kind: 'all' })
  })
})

describe('narrowEditPreviewToHunks', () => {
  const filePreview = {
    kind: 'file' as const, operation: 'update' as const, filePath: 'note.md',
    originalContent: before, modifiedContent: after, baseContent: before,
    previewParams: { filePath: 'note.md', content: after, expectedContent: before, workspaceIdentity: 'ws' },
  }
  const editorPreview = {
    kind: 'editor' as const, filePath: 'note.md', version: 4, baseContent: before,
    originalContent: before, modifiedContent: after,
  }
  const partial = acceptFirstAndThird

  it('note_update_file：寫入的 content 換成部分內容，expectedContent 不變', () => {
    const narrowed = narrowEditPreviewToHunks('note_update_file', filePreview, [0, 2])
    expect(narrowed?.preview.previewParams).toEqual({ ...filePreview.previewParams, content: partial })
    expect(narrowed?.preview.modifiedContent).toBe(partial)
    expect(narrowed?.preview.baseContent).toBe(before)
  })

  it('editor_apply_transaction：交給同一個行級事務後得到部分內容', () => {
    const narrowed = narrowEditPreviewToHunks('editor_apply_transaction', {
      ...editorPreview,
      previewParams: { filePath: 'note.md', version: 4, operations: [{ type: 'replace_lines', startLine: 2, endLine: 2, content: 'LINE TWO' }] },
    }, [0, 2])
    const operations = narrowed?.preview.previewParams.operations as unknown[]
    const prepared = prepareEditorLineTransaction(before, operations)
    expect(prepared.ok && prepared.markdown).toBe(partial)
    expect(narrowed?.preview.previewParams.version).toBe(4)
  })

  it('editor_replace_lines：整份行範圍換成部分內容', () => {
    const narrowed = narrowEditPreviewToHunks('editor_replace_lines', {
      ...editorPreview,
      previewParams: { filePath: 'note.md', version: 4, startLine: 2, endLine: 2, replaceContent: 'LINE TWO', preserveListStructure: false },
    }, [1])
    const params = narrowed!.preview.previewParams
    const prepared = prepareEditorLineTransaction(before, [{ type: 'replace_lines', startLine: params.startLine,
      endLine: params.endLine, content: params.replaceContent, preserveListStructure: params.preserveListStructure }])
    expect(prepared.ok && prepared.markdown).toBe(before.replace('line 12\n', ''))
  })

  it('選取範圍、刪除檔案、沒有接受任何處或不認得的工具都不縮小', () => {
    expect(narrowEditPreviewToHunks('editor_replace_range', { ...editorPreview, from: 1, to: 5, previewParams: {} }, [0])).toBeUndefined()
    expect(narrowEditPreviewToHunks('note_delete_file', { ...filePreview, operation: 'delete', modifiedContent: '' }, [0])).toBeUndefined()
    expect(narrowEditPreviewToHunks('note_update_file', filePreview, [])).toBeUndefined()
    expect(narrowEditPreviewToHunks('note_update_file', filePreview, [7, -1])).toBeUndefined()
    expect(narrowEditPreviewToHunks('canvas_apply_operations', filePreview, [0])).toBeUndefined()
  })
})

describe('describeHunkReview', () => {
  it('告訴 agent 哪幾處接受、哪幾處拒絕', () => {
    const { hunks } = buildDiffHunks(before, after)
    const accepted = new Set([0, 2])
    expect(hunkReviewData(hunks, accepted)).toEqual({ total: 3, accepted: [1, 3], rejected: [2] })
    const message = describeHunkReview(hunks, accepted)
    expect(message).toContain('共 3 處，接受 2 處（第 1、3 處），拒絕 1 處（第 2 處）')
    expect(message).toContain('- 第 1 處：已接受（原文第 2 行，改為 1 行）')
    expect(message).toContain('- 第 2 處：已拒絕，維持原文（刪除原文第 12 行）')
    expect(message).toContain('- 第 3 處：已接受（在原文第 22 行之後新增 2 行）')
  })
})

describe('findEditPreviewConflict', () => {
  const file = { kind: 'file' as const, operation: 'update' as const, baseContent: before, originalContent: before, previewParams: {} }
  const editor = { kind: 'editor' as const, baseContent: before, version: 4, originalContent: before, previewParams: {} }

  it('檔案在提案後被改過：偵測到衝突', () => {
    expect(findEditPreviewConflict(file, { content: before })).toBeUndefined()
    expect(findEditPreviewConflict(file, { content: `${before}使用者後來加的\n` })).toBe('FILE_CONTENT_CHANGED')
    expect(findEditPreviewConflict(file, { content: undefined })).toBe('FILE_CONTENT_CHANGED')
  })

  it('新建檔案時目標已出現：衝突', () => {
    const create = { ...file, operation: 'create' as const, baseContent: undefined, originalContent: '' }
    expect(findEditPreviewConflict(create, { content: undefined })).toBeUndefined()
    expect(findEditPreviewConflict(create, { content: '' })).toBe('FILE_CONTENT_CHANGED')
  })

  it('開著的筆記內容或版本變了：衝突', () => {
    expect(findEditPreviewConflict(editor, { content: before, version: 4 })).toBeUndefined()
    expect(findEditPreviewConflict(editor, { content: before.replace('line 3', 'line three'), version: 4 })).toBe('EDITOR_VERSION_MISMATCH')
    expect(findEditPreviewConflict(editor, { content: before, version: 5 })).toBe('EDITOR_VERSION_MISMATCH')
  })

  it('選取範圍的提案：選取移動或文字不同就是衝突', () => {
    const range = { ...editor, from: 10, to: 16, originalContent: 'line 2' }
    expect(findEditPreviewConflict(range, { content: before, version: 4, selection: { from: 10, to: 16, text: 'line 2' } })).toBeUndefined()
    expect(findEditPreviewConflict(range, { content: before, version: 4, selection: { from: 10, to: 17, text: 'line 2\n' } })).toBe('EDITOR_SELECTION_CHANGED')
    const insert = { ...editor, from: 10, to: 10, originalContent: '', previewParams: { position: 10 } }
    expect(findEditPreviewConflict(insert, { content: before, version: 4, selection: { from: 3, to: 10 } })).toBeUndefined()
    expect(findEditPreviewConflict(insert, { content: before, version: 4, selection: { from: 3, to: 11 } })).toBe('EDITOR_SELECTION_CHANGED')
  })
})
